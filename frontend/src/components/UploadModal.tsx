import { useState } from "react";
import type { FormEvent } from "react";
import { uploadRaster } from "../api/client";
import { refreshRasters } from "../state/actions";
import Modal from "./Modal";

interface UploadModalProps {
  projectId: string;
  onClose: () => void;
}

export default function UploadModal({ projectId, onClose }: UploadModalProps) {
  const [name, setName] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [crsEpsg, setCrsEpsg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tfw, setTfw] = useState<File | null>(null);
  const [prj, setPrj] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = progress !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !name.trim() || busy) return;
    setError(null);
    setProgress(0);
    try {
      await uploadRaster(
        projectId,
        {
          name: name.trim(),
          capturedAt: capturedAt || undefined,
          crsEpsg: crsEpsg.trim() || undefined,
          file,
          tfw,
          prj,
        },
        setProgress,
      );
      await refreshRasters(projectId);
      onClose();
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  function pickFile(setter: (f: File | null) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.files?.[0] ?? null);
      // Default the map name from the TIFF filename if empty.
      if (setter === setFile && e.target.files?.[0] && !name.trim()) {
        setName(e.target.files[0].name.replace(/\.tiff?$/i, ""));
      }
    };
  }

  return (
    <Modal title="Upload map (GeoTIFF)" onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(e) => void submit(e)} className="form">
        <label className="field">
          <span>GeoTIFF file (.tif)</span>
          <input
            type="file"
            accept=".tif,.tiff"
            onChange={pickFile(setFile)}
            required
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ward 12 — March 2026 drone survey"
            required
            disabled={busy}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Capture date (optional)</span>
            <input
              type="date"
              value={capturedAt}
              onChange={(e) => setCapturedAt(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>EPSG code (optional)</span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={crsEpsg}
              onChange={(e) => setCrsEpsg(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 32643"
              title="Only needed if the TIFF has no embedded CRS"
              disabled={busy}
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>.tfw world file (optional)</span>
            <input type="file" accept=".tfw" onChange={pickFile(setTfw)} disabled={busy} />
          </label>
          <label className="field">
            <span>.prj file (optional)</span>
            <input type="file" accept=".prj" onChange={pickFile(setPrj)} disabled={busy} />
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}

        {busy ? (
          <div className="upload-progress">
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
              />
            </div>
            <span className="mono">
              {progress !== null && progress >= 1
                ? "processing on server…"
                : `uploading ${Math.round((progress ?? 0) * 100)}%`}
            </span>
          </div>
        ) : (
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!file || !name.trim()}
            >
              Upload
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
