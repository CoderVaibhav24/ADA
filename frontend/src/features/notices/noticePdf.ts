/**
 * Getting the rendered notice out of an authenticated endpoint and onto screen.
 *
 * `GET /notices/{ref}/pdf` answers `application/pdf` behind the bearer token, so
 * neither `<a href>` nor `<iframe src>` can reach it — a browser sends no
 * Authorization header on either. Everything here exists because of that one
 * fact: fetch the bytes, wrap them in an object URL, and revoke it.
 *
 * Revoking is not tidiness. An un-revoked object URL pins the whole PDF in
 * memory for the lifetime of the document, and a register where an officer
 * opens thirty notices in a shift would hold thirty of them.
 *
 * The register DOWNLOADS and the detail screen PREVIEWS, deliberately: a
 * `window.open` issued after an `await` is blocked by every popup blocker
 * because the gesture has expired by then, so the register's Print control
 * saves the file instead of opening a tab that may never appear.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { IcmsApiError } from "@/api/icms/http";
import { fetchNoticePdf } from "@/api/icms/notices";
import { pdfFileName } from "./noticeModel";

/** How long a saved object URL is kept alive after the click that used it. */
const REVOKE_DELAY_MS = 10_000;

/** Saves the rendered notice to disk. Rejects with `IcmsApiError` on a refusal. */
export async function downloadNoticePdf(ref: string, signal: AbortSignal): Promise<void> {
  const blob = await fetchNoticePdf(ref, signal);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = pdfFileName(ref);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
}

export type NoticeDocument = {
  /** An object URL for an `<iframe>`, or null until the bytes arrive. */
  url: string | null;
  loading: boolean;
  error: IcmsApiError | null;
  refetch: () => void;
};

/**
 * The notice document as an object URL, for the detail screen's preview.
 *
 * `enabled` is the caller's `has_artefact`: a notice whose render is still
 * queued has no bytes to ask for, and asking anyway would put a 404 in the
 * server's log on every visit to a freshly issued notice.
 */
export function useNoticeDocument(ref: string, enabled: boolean): NoticeDocument {
  const { data, isPending, error, refetch } = useQuery<Blob, Error>({
    queryKey: ["icms", "notice-pdf", ref],
    queryFn: ({ signal }) => fetchNoticePdf(ref, signal),
    enabled: enabled && ref !== "",
    // The artefact is immutable once rendered — it is content-addressed by
    // `artefact_sha256` — so there is nothing to revalidate.
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });

  /* Derived during render and revoked on the way out, rather than written into
     state from an effect.
     `setUrl` inside an effect is the shape React's own documentation shows for
     object URLs, and it is a cascading render the compiler is right to flag:
     the URL is a pure function of the blob, so it is computed as one. The
     effect that remains does nothing but release it.
     The trade: React may discard a `useMemo` result, which would create a
     second URL and leak the first. That happens in StrictMode's double render
     and nowhere in production, and one leaked handle in development is cheaper
     than a second render of a screen holding a PDF. */
  const url = useMemo(() => (data ? URL.createObjectURL(data) : null), [data]);

  useEffect(() => {
    if (url === null) return;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  return {
    url,
    loading: enabled && ref !== "" && isPending,
    error: error instanceof IcmsApiError ? error : null,
    refetch: () => {
      void refetch();
    },
  };
}
