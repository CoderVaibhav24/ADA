import { useCallback, useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "@/api/icms/cases";
import { acceptEvidence, type EvidenceRejection } from "./complaintEvidence";

/** Where a photo came from: the officer's own pick, or the detection's imagery. */
export type PhotoOrigin = "officer" | "detection";

/** One chosen photo. `id` doubles as its upload idempotency key. */
export type ChosenPhoto = { id: string; file: File; url: string; origin: PhotoOrigin };

export type RejectedPhoto = { name: string; reason: EvidenceRejection };

/** The photos picked before submit, with their preview URLs revoked on remove and unmount. */
export function useEvidenceSelection() {
  const [items, setItems] = useState<ChosenPhoto[]>([]);
  const [rejected, setRejected] = useState<RejectedPhoto[]>([]);
  const itemsRef = useRef(items);

  useEffect(
    () => () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.url);
    },
    [],
  );

  const add = useCallback((files: readonly File[], origin: PhotoOrigin = "officer") => {
    const result = acceptEvidence(itemsRef.current.length, files);
    const fresh = result.accepted.map((file) => ({
      id: newIdempotencyKey(),
      file,
      url: URL.createObjectURL(file),
      origin,
    }));
    itemsRef.current = [...itemsRef.current, ...fresh];
    setItems(itemsRef.current);
    setRejected(result.rejected.map(({ file, reason }) => ({ name: file.name, reason })));
  }, []);

  const remove = useCallback((id: string) => {
    const gone = itemsRef.current.find((item) => item.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    itemsRef.current = itemsRef.current.filter((item) => item.id !== id);
    setItems(itemsRef.current);
    setRejected([]);
  }, []);

  return { items, rejected, add, remove };
}
