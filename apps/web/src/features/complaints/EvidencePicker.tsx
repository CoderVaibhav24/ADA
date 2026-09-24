import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { EVIDENCE_TYPES, MAX_EVIDENCE_FILES } from "./complaintEvidence";
import type { ComplaintNewLabels } from "./complaintLabels";
import type { DetectionEvidenceStatus } from "./useDetectionEvidence";
import type { ChosenPhoto, RejectedPhoto } from "./useEvidenceSelection";

type Props = {
  labels: ComplaintNewLabels;
  items: readonly ChosenPhoto[];
  rejected: readonly RejectedPhoto[];
  disabled: boolean;
  /** "idle" for a manual complaint, which leads with the drop zone. */
  detection: DetectionEvidenceStatus;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
};

/** Figma's "Evidence / Photographs": a drop zone, and thumbnail tiles, each removable. */
export function EvidencePicker({
  labels,
  items,
  rejected,
  disabled,
  detection,
  onAdd,
  onRemove,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const full = items.length >= MAX_EVIDENCE_FILES;

  const onDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (disabled || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onAdd(files);
  };

  const dropZone: ReactNode = full ? (
    <p role="status" className="text-xs text-fg-muted">
      {labels.evidence.full}
    </p>
  ) : (
    <label
      onDragOver={onDragOver}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-line-strong bg-surface-2 px-4 py-5 text-center text-fg-link transition-colors hover:border-line-accent has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring",
        dragging && "border-line-accent bg-accent-soft",
      )}
    >
      <Icon name="action.upload" className="size-6" />
      <span className="text-sm font-medium">{labels.evidence.drop}</span>
      <span className="text-2xs text-fg-faint">{labels.evidence.dropHint}</span>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={EVIDENCE_TYPES.join(",")}
        disabled={disabled}
        aria-label={labels.evidence.addLabel}
        aria-describedby={hintId}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared so choosing the same file again still fires a change.
          event.target.value = "";
          if (files.length > 0) onAdd(files);
        }}
      />
    </label>
  );

  const thumbnails: ReactNode = items.length > 0 && (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {items.map((item) => (
        <li
          key={item.id}
          className="relative h-24 overflow-hidden rounded-sm border border-status-success-border bg-surface-2"
        >
          <img src={item.url} alt={item.file.name} className="size-full object-cover" />
          {item.origin === "detection" && (
            <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-xs bg-surface-sunken/90 px-1.5 py-0.5 text-2xs font-medium text-fg-link">
              <Icon name="nav.changeDetection" className="size-3" />
              {labels.evidence.fromDetection}
            </span>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onRemove(item.id);
              inputRef.current?.focus();
            }}
            aria-label={labels.evidence.remove(item.file.name)}
            className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-status-danger text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Icon name="action.close" className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );

  const fromDetection = detection !== "idle";

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h3 id={titleId} className="text-xs font-medium text-fg-muted">
          {labels.evidence.label}
        </h3>
        <p id={hintId} className="text-xs text-fg-faint text-pretty">
          {labels.evidence.hint}
        </p>
      </div>

      {detection === "loading" && (
        <p role="status" className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon name="feedback.loading" spin className="size-3.5" />
          {labels.evidence.detectionLoading}
        </p>
      )}
      {detection === "failed" && (
        <p role="status" className="flex items-center gap-2 text-xs text-status-warning-fg">
          <Icon name="feedback.warning" className="size-3.5" />
          {labels.evidence.detectionFailed}
        </p>
      )}

      {/* The detection's own imagery leads when there is one; otherwise the
          officer is taken straight to adding a photo. */}
      {fromDetection ? thumbnails : dropZone}
      {fromDetection ? dropZone : thumbnails}

      {rejected.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-xs text-status-danger-fg">
          {rejected.map((item, index) => (
            <li key={`${item.name}-${String(index)}`}>
              {labels.evidence.rejected(item.reason, item.name)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
