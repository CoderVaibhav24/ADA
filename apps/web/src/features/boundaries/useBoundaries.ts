import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  importBoundaries,
  listBoundaryImports,
  type BoundaryImportRecord,
  type BoundaryImportResult,
} from "@/api/icms/geo";
import { IcmsApiError } from "@/api/icms/http";
import { PARCEL_QUERY_KEY } from "@/features/complaints/useLocationSuggestion";

const IMPORTS_KEY = ["icms", "geo", "imports"] as const;

// A 4xx is a verdict; retrying a 403 only asks the server to refuse again.
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/** The last twenty boundary imports. */
export function useBoundaryImports(enabled: boolean) {
  return useQuery<BoundaryImportRecord[], Error>({
    queryKey: IMPORTS_KEY,
    queryFn: ({ signal }) => listBoundaryImports(signal),
    enabled,
    staleTime: 30_000,
    retry: shouldRetry,
  });
}

export type ImportRequest = { file: File; dryRun: boolean; onProgress: (fraction: number) => void };

/** One upload; a real import refreshes the history, the zone lists and every cached parcel lookup. */
export function useImportBoundaries() {
  const client = useQueryClient();
  return useMutation<BoundaryImportResult, Error, ImportRequest>({
    mutationFn: ({ file, dryRun, onProgress }) => importBoundaries(file, dryRun, onProgress),
    onSuccess: async (_result, { dryRun }) => {
      if (dryRun) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: IMPORTS_KEY }),
        client.invalidateQueries({ queryKey: ["icms", "zones"] }),
        client.invalidateQueries({ queryKey: PARCEL_QUERY_KEY }),
      ]);
    },
  });
}
