import { useEffect, useRef, useState } from "react";
import { authHeader } from "@/api/client";
import {
  detectionEvidenceName,
  detectionPreviewPath,
  splitPreviewCard,
  type CropRect,
  type DetectionImageSide,
} from "./detectionEvidence";

/** Idle without a hand-off; otherwise fetching, attached, or failed (the form still files). */
export type DetectionEvidenceStatus = "idle" | "loading" | "ready" | "failed";

type Source = { detectionRef: string; jobId: string; polygonId: string };

// One panel of the card as its own PNG.
async function cropPanel(image: ImageBitmap, rect: CropRect): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("toBlob failed"));
    }, "image/png");
  });
}

// AFTER first, then BEFORE; the whole card when its layout is not the one we know.
async function detectionFiles(source: Source, signal: AbortSignal): Promise<File[]> {
  const response = await fetch(detectionPreviewPath(source.jobId, source.polygonId), {
    headers: await authHeader(),
    signal,
  });
  if (!response.ok) throw new Error(String(response.status));
  const card = await response.blob();
  const png = (blob: Blob, side: DetectionImageSide | "before-after") =>
    new File([blob], detectionEvidenceName(source.detectionRef, side), { type: "image/png" });

  const image = await createImageBitmap(card);
  try {
    const rects = splitPreviewCard(image.width, image.height);
    if (rects === null) return [png(card, "before-after")];
    const sides: DetectionImageSide[] = ["after", "before"];
    const blobs = await Promise.all(sides.map((side) => cropPanel(image, rects[side])));
    return sides.map((side, index) => png(blobs[index], side));
  } finally {
    image.close();
  }
}

/** Fetches the detection's before/after crop once and hands it to `onFiles` as evidence. */
export function useDetectionEvidence(
  source: Source | null,
  onFiles: (files: File[]) => void,
): DetectionEvidenceStatus {
  // The outcome is keyed by the detection it is for, so a new one reads as loading.
  const [settled, setSettled] = useState<{ key: string; status: DetectionEvidenceStatus } | null>(
    null,
  );
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  const detectionRef = source?.detectionRef;
  const jobId = source?.jobId;
  const polygonId = source?.polygonId;

  useEffect(() => {
    if (detectionRef === undefined || jobId === undefined || polygonId === undefined) return;
    const controller = new AbortController();
    const key = `${jobId}/${polygonId}`;
    detectionFiles({ detectionRef, jobId, polygonId }, controller.signal).then(
      (files) => {
        if (controller.signal.aborted) return;
        onFilesRef.current(files);
        setSettled({ key, status: "ready" });
      },
      () => {
        if (!controller.signal.aborted) setSettled({ key, status: "failed" });
      },
    );
    return () => {
      controller.abort();
    };
  }, [detectionRef, jobId, polygonId]);

  if (source === null) return "idle";
  return settled?.key === `${source.jobId}/${source.polygonId}` ? settled.status : "loading";
}
