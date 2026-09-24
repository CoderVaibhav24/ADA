import { useQuery } from "@tanstack/react-query";
import { IcmsApiError } from "@/api/icms/http";
import { getReportingStructure, type ReportingRole } from "@/api/icms/reporting";

// Under ["icms", "users"] so every officer write in UserDetailSheet refreshes the chart too.
export function useReportingStructure(enabled: boolean) {
  return useQuery<ReportingRole[], Error>({
    queryKey: ["icms", "users", "reporting"],
    queryFn: ({ signal }) => getReportingStructure(signal),
    enabled,
    staleTime: 30_000,
    retry: (failureCount, error) =>
      !(error instanceof IcmsApiError && error.status >= 400 && error.status < 500) &&
      failureCount < 2,
  });
}
