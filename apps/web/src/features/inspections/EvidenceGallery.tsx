/**
 * The evidence gallery — Figma 60:641's "Site Photographs" strip, given the
 * metadata the frame had no room for.
 *
 * Three things here are contract, not styling:
 *
 *   1. **The flagged geo-tag is visible on the tile.** `geotag_flagged` is
 *      computed by the server against a threshold no browser can read
 *      (contract §3), so the tile renders the boolean and never the arithmetic.
 *      It is said in words — "Geo-tag not trusted" — beside a warning glyph,
 *      because an amber border alone is invisible to a colour-blind officer and
 *      to a photocopy of a file note.
 *   2. **Nothing can be edited or deleted.** Evidence is append-only in this
 *      batch and every later one (§4.2), so the tile offers a download and
 *      there is no third button to look for.
 *   3. **A thumbnail is a fetch, not an `<img src>`.** `content_url` needs the
 *      bearer token and a browser sends no Authorization header on an image
 *      request, so each tile fetches its own bytes and renders an object URL —
 *      which it must revoke when it unmounts, or a gallery of forty photographs
 *      leaks forty blobs per visit.
 *   4. **The photograph rule is the server's number, said here in words.**
 *      `minimum_photo_count` and `maximum_photo_count` come from
 *      `/api/icms/app-config`; nothing in this file names a count of its own,
 *      and a rule that has not arrived is rendered as "not known" rather than
 *      as a bound this screen invented. Only `kind === "photo"` counts — a
 *      round carries documents and signatures too, and neither is a photograph.
 */

import { useEffect, useState, type ReactNode } from "react";
import { fetchEvidenceContent, type EvidenceOut } from "@/api/icms/inspections";
import { IcmsApiError } from "@/api/icms/http";
import { EmptyState, ErrorState } from "@/components/icms/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCaptureSourceLabels,
  useEvidenceKindLabels,
  useInspectionEvidenceLabels,
  useInspectionGateLabels,
  type InspectionEvidenceLabels,
} from "@/i18n/labels";
import { Icon, type IconKey } from "@/lib/icons";
import { actorLabel } from "@/lib/actor";
import { geoStateOf } from "./detailModel";
import { DetailPanel, Mono } from "./detailParts";
import { usePhotoRuleLabels, type PhotoRuleLabels } from "./photoRuleLabels";
import { usePhotoRule, type PhotoRuleState } from "./useAppConfig";

const KIND_ICON: Record<string, IconKey> = {
  photo: "inspection.photo",
  video: "inspection.photo",
  document: "notice.attachment",
  signature: "notice.seal",
};

// Only an image has a thumbnail worth the round trip; everything else gets its
// kind's glyph rather than a download of a 40 MB video nobody asked for.
function isImage(evidence: EvidenceOut): boolean {
  return (evidence.content_type ?? "").startsWith("image/");
}

/** Saves a blob under the name the field app uploaded it with. */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/** One image's bytes as an object URL, revoked when the tile goes away. */
function useThumbnail(evidenceId: number, enabled: boolean, stamped: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;

    void fetchEvidenceContent(evidenceId, controller.signal, stamped)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        // A thumbnail that will not load is not an error state: the metadata
        // beside it is the evidence record, and the download still works.
        setUrl(null);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [evidenceId, enabled, stamped]);

  return url;
}

function EvidenceTile({
  evidence,
  labels,
  formatDateTime,
}: {
  evidence: EvidenceOut;
  labels: InspectionEvidenceLabels;
  formatDateTime: (value: string) => string;
}) {
  const kindLabels = useEvidenceKindLabels();
  const sourceLabels = useCaptureSourceLabels();
  const [downloading, setDownloading] = useState(false);
  const image = isImage(evidence);
  const thumbnail = useThumbnail(evidence.id, image, evidence.stamped_url != null);
  const geo = geoStateOf(evidence);
  const filename = evidence.original_filename ?? String(evidence.id);
  const uploader = actorLabel(evidence.uploaded_by_name, evidence.uploaded_by);

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await fetchEvidenceContent(evidence.id, new AbortController().signal);
      save(blob, filename);
    } catch {
      // The button returns to rest. The file is still reachable through the
      // server's own download route; nothing has been lost here.
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-line-subtle bg-surface-2 p-2">
      <div className="flex h-20 items-center justify-center overflow-hidden rounded-xs bg-surface-sunken">
        {image && thumbnail === null && <Skeleton className="size-full" />}
        {image && thumbnail !== null && (
          <img src={thumbnail} alt={labels.open(filename)} className="size-full object-cover" />
        )}
        {!image && (
          <span className="flex flex-col items-center gap-1 text-fg-faint">
            <Icon name={KIND_ICON[evidence.kind] ?? "notice.attachment"} className="size-5" />
            <span className="text-2xs">{labels.previewUnavailable}</span>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{kindLabels[evidence.kind] ?? evidence.kind}</Badge>
        {evidence.round_no != null && (
          <Badge variant="outline" className="tabular">
            {labels.round(evidence.round_no)}
          </Badge>
        )}
      </div>

      {/* The server's verdict, in words. Never recomputed from accuracy_m. */}
      {geo.trusted ? (
        <p className="flex flex-wrap items-center gap-1.5 text-2xs text-status-success-fg">
          <Icon name="map.pin" className="size-3.5 shrink-0" />
          {labels.geotagged}
          {geo.accuracyM !== null && (
            <span className="tabular">{labels.accuracy(geo.accuracyM)}</span>
          )}
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-1.5 text-2xs font-medium text-status-warning-fg">
          <Icon name="feedback.warning" className="size-3.5 shrink-0" />
          {labels.flagged}
          {!geo.hasFix && <span>{labels.noLocation}</span>}
        </p>
      )}

      <dl className="flex min-w-0 flex-col gap-0.5 text-2xs text-fg-muted">
        <div className="min-w-0">
          <dt className="sr-only">{labels.uploadedAt("")}</dt>
          <dd className="truncate">{labels.uploadedAt(formatDateTime(evidence.uploaded_at))}</dd>
        </div>
        <div className="min-w-0">
          <dt className="sr-only">{labels.uploadedBy("")}</dt>
          <dd className="truncate" title={uploader.title}>
            {labels.uploadedBy(uploader.text)}
          </dd>
        </div>
        {evidence.capture_source != null && (
          <div className="min-w-0">
            <dt className="sr-only">{labels.kindLabel}</dt>
            <dd className="truncate">
              {sourceLabels[evidence.capture_source] ?? evidence.capture_source}
            </dd>
          </div>
        )}
        {evidence.sha256 != null && (
          <div className="min-w-0">
            <dt className="sr-only">{labels.checksum}</dt>
            <dd className="truncate">
              <Mono className="text-fg-faint">{evidence.sha256.slice(0, 16)}</Mono>
            </dd>
          </div>
        )}
      </dl>

      <Button
        variant="outline"
        size="sm"
        className="mt-auto w-full"
        disabled={downloading}
        onClick={() => {
          void download();
        }}
      >
        <Icon
          name={downloading ? "feedback.loading" : "action.download"}
          spin={downloading}
          className="size-4"
        />
        {downloading ? labels.downloading : labels.download}
      </Button>
    </li>
  );
}

/** Where the round stands against the server's rule, in a sentence with its numbers in it. */
function PhotoRuleNotice({
  photos,
  labels,
}: {
  photos: PhotoRuleState;
  labels: PhotoRuleLabels;
}) {
  if (photos.loading) return null;

  // The ceiling first: it is the one state with no way back, because evidence
  // is append-only and nothing here can remove a photograph to make room.
  if (photos.atCeiling && photos.maximum !== null) {
    return (
      <p
        role="status"
        className="max-w-prose rounded-md border border-status-warning-border bg-status-warning px-3 py-2 text-2xs text-status-warning-fg text-pretty"
      >
        {labels.ceiling(photos.maximum)}
      </p>
    );
  }

  if (photos.shortfall > 0 && photos.minimum !== null) {
    return (
      <p role="status" className="max-w-prose text-2xs text-fg-muted text-pretty">
        {labels.shortfall(photos.count, photos.minimum)}
      </p>
    );
  }

  // Not a guess at the bound and not silence: the officer is told the portal
  // does not know the rule, and that the server applies it regardless.
  if (!photos.stated) {
    return <p className="max-w-prose text-2xs text-fg-faint text-pretty">{labels.unknown}</p>;
  }

  return null;
}

export function EvidenceGallery({
  evidence,
  status,
  error,
  onRetry,
  canRead,
  aside,
  formatDateTime,
}: {
  evidence: readonly EvidenceOut[];
  status: "pending" | "error" | "success";
  error: unknown;
  onRetry: () => void;
  /** `evidence.read`. Without it the gallery is refused and the rest is not. */
  canRead: boolean;
  aside?: ReactNode;
  formatDateTime: (value: string) => string;
}) {
  const labels = useInspectionEvidenceLabels();
  const gateLabels = useInspectionGateLabels();
  const photoLabels = usePhotoRuleLabels();
  const photos = usePhotoRule(evidence, canRead);
  const api = error instanceof IcmsApiError ? error : null;
  const flagged = evidence.some((item) => item.geotag_flagged);
  const loaded = canRead && status === "success";

  return (
    <DetailPanel
      title={labels.title}
      description={labels.appendOnly}
      aside={
        <>
          {loaded && (
            <span className="text-2xs text-fg-faint tabular">
              {labels.count(evidence.length)}
            </span>
          )}
          {/* The rule beside the count, because "8 files" says nothing about
              whether this round holds the photographs it is held to. */}
          {loaded && photos.minimum !== null && photos.maximum !== null && (
            <span className="text-2xs text-fg-muted tabular">
              {photoLabels.rule(photos.count, photos.maximum, photos.minimum)}
            </span>
          )}
          {aside}
        </>
      }
    >
      {/* Above the grid and outside its empty state: a round with no
          photographs at all is exactly when the rule needs saying. */}
      {loaded && <PhotoRuleNotice photos={photos} labels={photoLabels} />}

      {!canRead ? (
        <EmptyState
          size="compact"
          icon="user.password"
          title={gateLabels.evidenceDeniedTitle}
          description={gateLabels.evidenceDeniedBody}
        />
      ) : status === "error" ? (
        <ErrorState
          size="compact"
          title={labels.errorTitle}
          description={api?.message ?? labels.errorBody}
          detail={api?.requestId ?? undefined}
          onRetry={onRetry}
          retryLabel={labels.errorRetry}
        />
      ) : status === "pending" ? (
        <ul
          aria-busy
          aria-label={labels.loading}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} aria-hidden>
              <Skeleton className="h-44 w-full rounded-md" />
            </li>
          ))}
        </ul>
      ) : evidence.length === 0 ? (
        <EmptyState
          size="compact"
          icon="inspection.photo"
          title={labels.emptyTitle}
          description={labels.emptyBody}
        />
      ) : (
        <>
          {/* Said once, above the grid, rather than on every tile: the sentence
              is four lines long and the tiles are a third of a column wide. */}
          {flagged && (
            <p className="max-w-prose rounded-md border border-status-warning-border bg-status-warning px-3 py-2 text-2xs text-status-warning-fg text-pretty">
              {labels.flaggedReason}
            </p>
          )}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {evidence.map((item) => (
              <EvidenceTile
                key={item.id}
                evidence={item}
                labels={labels}
                formatDateTime={formatDateTime}
              />
            ))}
          </ul>
        </>
      )}
    </DetailPanel>
  );
}
