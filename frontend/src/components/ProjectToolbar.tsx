/**
 * The change-detection console's own toolbar.
 *
 * This is what is left of the old `<Header>` after the shell landed. That
 * header carried three unrelated things — the brand, the signed-in identity
 * with Sign out, and the project controls. The first two are true of every
 * screen in the portal and now live in `AppShell` via `ProtectedLayout`; only
 * the project controls are true of THIS screen, because a "current project" is
 * a change-detection idea and means nothing on the Notices register.
 *
 * So: project selector, New project, Training set export and Delete project,
 * and nothing else. No brand, no identity, no Sign out — those would be the
 * duplicate chrome the shell was built to remove.
 *
 * Still on the console's hand-written CSS (`.header-project`, `.btn`, `.select`)
 * rather than the ICMS token layer: the whole console is on that stylesheet and
 * converting one strip of it would make the toolbar the only element on the
 * screen in a different visual language. It converts with the console.
 */

import { useState } from "react";
import { useStore, sid } from "../state/store";
import { deleteProject, selectProject } from "../state/actions";
import { download, downloadUrl } from "../api/client";
import { consoleLabelsEn } from "../routes/labels.en";
import { IconDownload, IconPlus, IconTrash } from "./Icons";
import NewProjectModal from "./NewProjectModal";

export default function ProjectToolbar() {
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const [showNewProject, setShowNewProject] = useState(false);

  const labels = consoleLabelsEn;
  const current = projects.find((p) => sid(p.id) === currentProjectId);

  async function handleDeleteProject() {
    if (!current) return;
    if (window.confirm(labels.confirmDelete(current.name))) {
      await deleteProject(current.id);
    }
  }

  return (
    <div className="console-toolbar" aria-label={labels.toolbarLandmark}>
      <div className="header-project">
        <label htmlFor="project-select" className="header-label">
          {labels.projectLabel}
        </label>
        <select
          id="project-select"
          className="select"
          value={currentProjectId ?? ""}
          onChange={(e) => selectProject(e.target.value)}
          disabled={projects.length === 0}
        >
          {projects.length === 0 && <option value="">{labels.noProjects}</option>}
          {projects.map((p) => (
            <option key={sid(p.id)} value={sid(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setShowNewProject(true)}
        >
          <IconPlus /> {labels.newProject}
        </button>
        {current && (
          <button
            type="button"
            className="btn btn-ghost"
            title={labels.trainingSetHint}
            onClick={() =>
              void download(
                downloadUrl.feedbackDataset(current.id),
                `pcsmcpl_feedback_${sid(current.id)}.geojson`,
              )
            }
          >
            <IconDownload /> {labels.trainingSet}
          </button>
        )}
        {current && (
          <button
            type="button"
            className="icon-btn danger"
            title={labels.deleteProject}
            aria-label={labels.deleteProject}
            onClick={() => void handleDeleteProject()}
          >
            <IconTrash />
          </button>
        )}
      </div>

      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} />
      )}
    </div>
  );
}
