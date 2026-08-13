import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "supertokens-auth-react/recipe/session";
import { USER_EMAIL_KEY } from "../config/supertokens";
import { useStore, sid } from "../state/store";
import { deleteProject, selectProject } from "../state/actions";
import { downloadUrl } from "../api/client";
import { IconDownload, IconPlus, IconSignOut, IconTrash } from "./Icons";
import NewProjectModal from "./NewProjectModal";

export default function Header() {
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const [showNewProject, setShowNewProject] = useState(false);
  const navigate = useNavigate();

  const email =
    window.localStorage.getItem(USER_EMAIL_KEY) ?? "authenticated operator";
  const current = projects.find((p) => sid(p.id) === currentProjectId);

  async function handleSignOut() {
    await signOut();
    window.localStorage.removeItem(USER_EMAIL_KEY);
    navigate("/auth");
  }

  async function handleDeleteProject() {
    if (!current) return;
    if (
      window.confirm(
        `Delete project "${current.name}" and all of its maps, analyses and red zones?`,
      )
    ) {
      await deleteProject(current.id);
    }
  }

  return (
    <header className="app-header">
      <div className="brand">
        <img className="brand-logo" src="/logo-mcpl.svg" alt="PCSMCPL" />
        <div className="brand-text">
          <h1>PCSMCPL Change Detection</h1>
          <span>PCSMCPL · Encroachment Monitoring</span>
        </div>
      </div>

      <div className="header-project">
        <label htmlFor="project-select" className="header-label">
          Project
        </label>
        <select
          id="project-select"
          className="select"
          value={currentProjectId ?? ""}
          onChange={(e) => selectProject(e.target.value)}
          disabled={projects.length === 0}
        >
          {projects.length === 0 && <option value="">— none —</option>}
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
          <IconPlus /> New project
        </button>
        {current && (
          <a
            className="btn btn-ghost"
            href={downloadUrl.feedbackDataset(current.id)}
            download={`pcsmcpl_feedback_${sid(current.id)}.geojson`}
            title="Export every officer-verified detection as labelled training data for the next fine-tuning cycle"
          >
            <IconDownload /> Training set
          </a>
        )}
        {current && (
          <button
            type="button"
            className="icon-btn danger"
            title="Delete current project"
            onClick={() => void handleDeleteProject()}
          >
            <IconTrash />
          </button>
        )}
      </div>

      <div className="header-user">
        <span className="user-email" title={email}>
          {email}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void handleSignOut()}
        >
          <IconSignOut /> Sign out
        </button>
      </div>

      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} />
      )}
    </header>
  );
}
