import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import {
  loadProjectData,
  loadProjects,
  pollAnalysis,
  refreshRasters,
} from "../state/actions";
import Header from "./Header";
import Sidebar from "./Sidebar";
import MapView from "./MapView";
import NewProjectModal from "./NewProjectModal";

const RASTER_POLL_MS = 3000;
const ANALYSIS_POLL_MS = 2000;

export default function Dashboard() {
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
    <div className="app-shell">
      <Header />
      {globalError && (
        <div className="global-error" role="alert">
          {globalError}
        </div>
      )}
      {projectsLoaded && !hasProjects ? (
        <FirstProjectPrompt />
      ) : (
        <div className="app-main">
          <Sidebar />
          <MapView />
        </div>
      )}
    </div>
  );
}

function FirstProjectPrompt() {
  const [open, setOpen] = useState(false);
  return (
    <div className="empty-screen">
      <div className="empty-card">
        <div className="empty-kicker">No projects yet</div>
        <h2>Create your first project</h2>
        <p>
          A project groups the drone / satellite maps of one survey area, its
          red zones and every change-detection run between two epochs.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setOpen(true)}
        >
          Create project
        </button>
      </div>
      {open && <NewProjectModal onClose={() => setOpen(false)} />}
    </div>
  );
}
