import { useState } from "react";
import type { FormEvent } from "react";
import { createProject } from "../state/actions";
import Modal from "./Modal";

export default function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await createProject(name.trim(), description.trim() || undefined);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="form">
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Taj East Gate corridor"
            required
          />
        </label>
        <label className="field">
          <span>Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Survey area, ward number, notes…"
          />
        </label>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
