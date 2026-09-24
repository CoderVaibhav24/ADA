/**
 * `/administration` — the policy area, and the render-level gate in front of it.
 *
 * ## Where gating happens, and what each place is worth
 *
 * Three places, and only the third is a control:
 *
 *   1. the rail — `navForPermissions` drops the entry without `policy.read`;
 *   2. here — a typed URL still reaches this component, which refuses to render
 *      the screens without `policy.read`, and passes `canManage` down so every
 *      write control is disabled without `policy.manage`;
 *   3. **ada-api** — `require_permission("policy.read" | "policy.manage")` on
 *      every one of the seven endpoints.
 *
 * Only (3) enforces anything. `/me/capabilities` carries `advisory: true` in its
 * own payload for exactly this reason: 1 and 2 decide which doors are drawn, 3
 * decides which ones open. A tampered capabilities response buys a button and a
 * 403.
 *
 * ## The screens are tabs, not routes
 *
 * One rail entry, one path prefix, one thing the officer calls
 * "Administration". `?tab=` keeps a particular screen linkable without putting
 * four matching prefixes into `activeNavId`. Reporting is read-only and gated on
 * `user.read` inside its own panel, since it lists officers rather than policy.
 * Boundaries (the KML land-record import) is drawn only for BOUNDARY_IMPORT_PERMISSION.
 */

import { useCallback, useState } from "react";
import { BOUNDARY_IMPORT_PERMISSION } from "@/api/icms/geo";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePolicyLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import PermissionsCatalogue from "./PermissionsCatalogue";
import RoleGrantsMatrix from "./RoleGrantsMatrix";
import TransitionsEditor from "./TransitionsEditor";
import BoundaryImport from "@/features/boundaries/BoundaryImport";
import { useBoundaryLabels } from "@/features/boundaries/labels";
import ReportingStructure from "@/features/reporting/ReportingStructure";
import { useReportingLabels } from "@/features/reporting/labels";
import { PolicySaved } from "./parts";
import { useCapabilityGate } from "./usePolicy";

const TABS = ["permissions", "roles", "workflow", "reporting", "boundaries"] as const;
type TabId = (typeof TABS)[number];

function isTabId(value: string | null): value is TabId {
  return TABS.includes(value as TabId);
}

export default function PolicyAdmin() {
  const labels = usePolicyLabels();
  const reportingLabels = useReportingLabels();
  const boundaryLabels = useBoundaryLabels();
  const gate = useCapabilityGate();
  const canImportBoundaries = gate.permissions.includes(BOUNDARY_IMPORT_PERMISSION);
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useState(false);

  const raw = params.get("tab");
  // A typed `?tab=boundaries` without the permission lands on the first tab, like an unknown one.
  const tab: TabId =
    isTabId(raw) && (raw !== "boundaries" || canImportBoundaries) ? raw : "permissions";

  const selectTab = useCallback(
    (next: string) => {
      // `replace`, not push: flipping between four tabs must not make Back
      // walk through every one of them to leave the screen.
      const updated = new URLSearchParams(params);
      updated.set("tab", next);
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  const onSaved = useCallback(() => {
    setSaved(true);
  }, []);

  if (gate.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
        <span className="flex items-center gap-2 text-sm text-fg-muted">
          <Icon name="feedback.loading" spin className="size-4" />
          {labels.gate.checking}
        </span>
      </div>
    );
  }

  // Not a redirect to the login screen: the officer IS signed in, they are
  // simply not allowed here, and a login form they already passed reads as a bug.
  if (!gate.canRead) {
    return (
      <section
        role="alert"
        className="mx-auto flex min-h-[40vh] max-w-prose flex-col items-center justify-center gap-3 px-4 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-full border border-line-subtle bg-surface-2 text-fg-faint">
          <Icon name="user.password" className="size-5" />
        </span>
        <h1 className="font-display text-xl font-bold text-balance text-fg-strong">
          {labels.gate.deniedTitle}
        </h1>
        <p className="text-sm text-fg-canvas-muted text-pretty">{labels.gate.deniedBody}</p>
      </section>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
            {labels.title}
          </h1>
          <p className="mt-1 max-w-prose text-sm text-fg-canvas-muted text-pretty">{labels.subtitle}</p>
        </div>
        {/* The live revision, so an admin can watch it move when they save. */}
        <div className="flex flex-wrap items-center gap-2">
          {gate.policyRevision !== null && (
            <Badge variant="secondary" className="tabular">
              {labels.revision(gate.policyRevision)}
            </Badge>
          )}
          {gate.policySource && (
            <span className="text-2xs text-fg-faint">
              {labels.sourceLabel}: {labels.source(gate.policySource)}
            </span>
          )}
        </div>
      </header>

      {saved && (
        <PolicySaved
          revision={gate.policyRevision}
          labels={labels}
          onDismiss={() => {
            setSaved(false);
          }}
        />
      )}

      <p className="max-w-prose text-2xs text-fg-faint text-pretty">{labels.advisory}</p>

      <Tabs value={tab} onValueChange={selectTab} className="min-w-0 gap-4">
        {/* Scrolls rather than wraps at 360: four triggers reflowing to two
            lines move the panel under the officer's thumb between taps. */}
        <TabsList className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="permissions">{labels.tabs.permissions}</TabsTrigger>
          <TabsTrigger value="roles">{labels.tabs.roleGrants}</TabsTrigger>
          <TabsTrigger value="workflow">{labels.tabs.transitions}</TabsTrigger>
          <TabsTrigger value="reporting">{reportingLabels.tab}</TabsTrigger>
          {canImportBoundaries && (
            <TabsTrigger value="boundaries">{boundaryLabels.tab}</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="permissions" className="min-w-0">
          <PermissionsCatalogue labels={labels} canManage={gate.canManage} onSaved={onSaved} />
        </TabsContent>

        <TabsContent value="roles" className="min-w-0">
          <RoleGrantsMatrix labels={labels} canManage={gate.canManage} onSaved={onSaved} />
        </TabsContent>

        <TabsContent value="workflow" className="min-w-0">
          <TransitionsEditor labels={labels} canManage={gate.canManage} onSaved={onSaved} />
        </TabsContent>

        <TabsContent value="reporting" className="min-w-0">
          <ReportingStructure />
        </TabsContent>

        {canImportBoundaries && (
          <TabsContent value="boundaries" className="min-w-0">
            <BoundaryImport canImport={canImportBoundaries} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
