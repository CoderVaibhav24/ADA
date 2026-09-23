/**
 * The server's published rules, fetched once for the whole portal.
 *
 * One query key — `["icms","app-config"]` — the way `["icms","capabilities"]`
 * is already shared between the register, the detail screen and the findings
 * form. Three screens ask about the photograph rule on one inspection; they make
 * one request between them and cannot disagree about the answer.
 *
 * `enabled` is the caller's gate, not a permission check: `/app-config` needs no
 * permission code, but a screen that has just been refused should not fire a
 * request whose answer it will never draw.
 *
 * There is no `placeholderData` and no default here on purpose. While the
 * request is in flight the rule is UNKNOWN, and unknown is a state the screens
 * render as a sentence — not a number the portal guessed and will be believed.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAppConfig, type AppConfig } from "@/api/icms/appConfig";
import { IcmsApiError } from "@/api/icms/http";
import type { EvidenceOut } from "@/api/icms/inspections";
import { countPhotographs, photoRuleOf, type PhotoRule } from "./photoRule";

/** Shared, so a second screen asking costs nothing and answers the same. */
export const APP_CONFIG_KEY = ["icms", "app-config"] as const;

// A 4xx is a verdict, not a blip — the rule every other query here follows.
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export type AppConfigState = {
  loading: boolean;
  /** `null` until it has actually arrived. Never a stand-in. */
  config: AppConfig | null;
  /** It was asked for and did not arrive. The server still enforces the rules. */
  unavailable: boolean;
};

/** The rules the server enforces, under one key for every screen that needs them. */
export function useAppConfig(enabled: boolean): AppConfigState {
  const { data, isPending, error } = useQuery<AppConfig, Error>({
    queryKey: APP_CONFIG_KEY,
    queryFn: ({ signal }) => fetchAppConfig(signal),
    enabled,
    // A settings change moves these, not a page view; five minutes is fresh
    // enough for an advisory sentence and far short of "for this session".
    staleTime: 5 * 60 * 1000,
    retry: shouldRetry,
  });

  return {
    loading: enabled && isPending,
    config: data ?? null,
    unavailable: enabled && error !== null,
  };
}

export type PhotoRuleState = PhotoRule & {
  /** The rule has been asked for and has not answered yet. */
  loading: boolean;
};

/** This round's photographs against the published bounds — never against a literal. */
export function usePhotoRule(
  evidence: readonly EvidenceOut[],
  enabled: boolean,
): PhotoRuleState {
  const { config, loading } = useAppConfig(enabled);
  return useMemo(
    () => ({ ...photoRuleOf(config, countPhotographs(evidence)), loading }),
    [config, evidence, loading],
  );
}
