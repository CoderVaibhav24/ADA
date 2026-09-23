import { useEffect, useState } from "react";
import { Icon } from "@/lib/icons";
import { useConsoleLabels } from "@/i18n/labels";
import { useStore } from "../state/store";
import {
  loadProjectData,
  loadProjects,
  pollAnalysis,
  refreshRasters,
} from "../state/actions";
import ProjectToolbar from "./ProjectToolbar";
import Sidebar from "./Sidebar";
import MapView from "./MapView";
import NewProjectModal from "./NewProjectModal";

const RASTER_POLL_MS = 3000;
const ANALYSIS_POLL_MS = 2000;

export default function Dashboard() {
  const labels = useConsoleLabels();
  // Below `lg` the 340px layer panel would leave 20px of map at 360px, so it
  // becomes an off-canvas drawer. See `.layers-toggle` in styles.css.
  const [layersOpen, setLayersOpen] = useState(false);
  const projectsLoaded = useStore((s) => s.projectsLoaded);
  const hasProjects = useStore((s) => s.projects.length > 0);
  const pid = useStore((s) => s.currentProjectId);
  const globalError = useStore((s) => s.globalError);

  const anyRasterProcessing = useStore((s) =>
    s.rasters.some((r) => r.status === "processing"),
  );
  // Comma-joined so the selector returns a primitive (stable Object.is compare).
  const activeAnalysisIds = useStore((s) =>
    s.analyses
      .filter((a) => a.status === "queued" || a.status === "running")
      .map((a) => String(a.id))
      .join(","),
  );

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (pid) void loadProjectData(pid);
  }, [pid]);

  // Poll rasters while any are still processing.
  useEffect(() => {
    if (!pid || !anyRasterProcessing) return;
    const t = window.setInterval(() => void refreshRasters(pid), RASTER_POLL_MS);
    return () => window.clearInterval(t);
  }, [pid, anyRasterProcessing]);

  // Poll each queued/running analysis for progress + stage.
  useEffect(() => {
    if (!activeAnalysisIds) return;
    const ids = activeAnalysisIds.split(",");
    const t = window.setInterval(() => {
      for (const id of ids) void pollAnalysis(id);
    }, ANALYSIS_POLL_MS);
    return () => window.clearInterval(t);
  }, [activeAnalysisIds]);

  return (
    <div className="console-shell">
      <ProjectToolbar />
      {globalError && (
        <div className="global-error" role="alert">
          {globalError}
        </div>
      )}
      {projectsLoaded && !hasProjects ? (
        <FirstProjectPrompt />
      ) : (
        <div className="app-main" data-layers-open={layersOpen}>
          {/* Sits before the panel in the DOM, so opening the drawer does not
              reorder the tab sequence: toggle -> panel -> map. */}
          <button
            type="button"
            className="layers-toggle"
            aria-expanded={layersOpen}
            aria-controls="console-layers"
            onClick={() => setLayersOpen((open) => !open)}
          >
            <Icon name="map.layers" className="size-4" />
            <span>{layersOpen ? labels.closeLayers : labels.openLayers}</span>
          </button>
          {layersOpen && (
            <button
              type="button"
              className="layers-scrim"
              aria-label={labels.closeLayers}
              onClick={() => setLayersOpen(false)}
            />
          )}
          <Sidebar id="console-layers" label={labels.layersPanel} open={layersOpen} />
          <MapView />
        </div>
      )}
    </div>
  );
}

function FirstProjectPrompt() {
  const labels = useConsoleLabels();
  const [open, setOpen] = useState(false);
  return (
    <div className="empty-screen">
      <div className="empty-card">
        <div className="empty-kicker">{labels.firstProjectKicker}</div>
        <h2>{labels.firstProjectTitle}</h2>
        <p>{labels.firstProjectBody}</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setOpen(true)}
        >
          {labels.firstProjectAction}
        </button>
      </div>
      {open && <NewProjectModal onClose={() => setOpen(false)} />}
    </div>
  );
}
