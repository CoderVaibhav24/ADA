import { useEffect, useState } from "react";
import type { User } from "oidc-client-ts";
import { currentUser, displayName, logout } from "../auth/oidc";
import { useStore, sid } from "../state/store";
import { deleteProject, selectProject } from "../state/actions";
import { download, downloadUrl } from "../api/client";
import { IconDownload, IconPlus, IconSignOut, IconTrash } from "./Icons";
import NewProjectModal from "./NewProjectModal";

export default function Header() {
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const [showNewProject, setShowNewProject] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // The address comes off the ID token now rather than out of localStorage,
  // where the old code had to stash it because SuperTokens' access token did
  // not carry one.
  useEffect(() => {
    void currentUser().then(setUser);
  }, []);

  const email = displayName(user);
  const current = projects.find((p) => sid(p.id) === currentProjectId);

  async function handleSignOut() {
    // logout() knows which kind of session is live: an OIDC one is ended at
    // Keycloak (which redirects back to /auth/signed-out), an OTP one by
    // revoking its refresh token at ada-auth. Either way the navigation is
    // handled there, so there is no navigate() here.
    await logout();
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
          <button
            type="button"
            className="btn btn-ghost"
            title="Export every officer-verified detection as labelled training data for the next fine-tuning cycle"
            onClick={() =>
              void download(
                downloadUrl.feedbackDataset(current.id),
                `pcsmcpl_feedback_${sid(current.id)}.geojson`,
              )
            }
          >
            <IconDownload /> Training set
          </button>
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
