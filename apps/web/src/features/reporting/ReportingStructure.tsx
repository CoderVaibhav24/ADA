/**
 * Administration → Reporting: the role ladder as an org chart, then as a list.
 *
 * The chart is drawn from a generic `OrgTreeNode` tree (see `tree.ts`); this
 * file only knows how to render a ROLE box. The list below the chart carries the
 * same content for keyboard and screen-reader use, where a pan/zoom canvas does
 * not. Officers open in the same `UserDetailSheet` the Officers screen uses.
 */

import { Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo, useState } from "react";
import type { ReportingMember, ReportingRole } from "@/api/icms/reporting";
import FlowCanvas, { type FlowSelection } from "@/components/flow/FlowCanvas";
import { layoutGraph } from "@/components/flow/layout";
import { EmptyState, ErrorState, LoadingState } from "@/components/icms/states";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/i18n";
import { Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useUserLabels } from "@/features/users/labels";
import { displayName } from "@/features/users/officer";
import UserDetailSheet from "@/features/users/UserDetailSheet";
import { useUserGate } from "@/features/users/useUsers";
import { useReportingLabels, type ReportingLabels } from "./labels";
import { MEMBER_PREVIEW, roleLadderTree, treeEdges, visibleCount, type OrgTreeNode } from "./tree";
import { useReportingStructure } from "./useReporting";

const BOX_WIDTH = 264;
const HEADER = 64;
const ROW = 42;
const FOOTER = 34;
const PAD = 10;

type MemberView = { id: string; name: string; zones: string; enabled: boolean };

type RoleBoxData = {
  title: string;
  subtitle: string;
  count: string;
  members: MemberView[];
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (userId: string) => void;
  labels: ReportingLabels;
};

type RoleBoxNode = Node<RoleBoxData, "role">;

const HIDDEN_HANDLE = "!pointer-events-none !size-1 !min-w-0 !border-0 !bg-transparent";

// One role: its name, where it reports, and the officers holding it.
function RoleBox({ data, selected, width, height }: NodeProps<RoleBoxNode>) {
  const { labels } = data;
  return (
    <div
      style={{ width, height }}
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-line bg-surface-2 text-left",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-surface-sunken",
      )}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className={HIDDEN_HANDLE} />
      <div className="flex items-start justify-between gap-2 border-b border-line-subtle px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg-strong">{data.title}</p>
          <p className="truncate text-2xs text-fg-muted">{data.subtitle}</p>
        </div>
        <Badge variant="secondary" className="shrink-0 tabular">
          {data.count}
        </Badge>
      </div>
      <ul className="flex min-h-0 flex-col px-1 py-1">
        {data.members.length === 0 && (
          <li className="px-2 py-2 text-2xs text-fg-faint">{labels.noMembers}</li>
        )}
        {data.members.map((member) => (
          <li key={member.id}>
            <button
              type="button"
              className="nodrag nopan flex w-full min-w-0 flex-col rounded-sm px-2 py-1 text-left hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={labels.openOfficer(member.name)}
              onClick={() => {
                data.onOpen(member.id);
              }}
            >
              <span
                className={cn(
                  "flex w-full min-w-0 items-center gap-1.5 text-xs font-medium text-fg-strong",
                  !member.enabled && "text-fg-faint line-through",
                )}
              >
                <span className="truncate">{member.name}</span>
                {!member.enabled && (
                  <span className="shrink-0 text-2xs font-normal no-underline">({labels.disabled})</span>
                )}
              </span>
              <span className="w-full truncate text-2xs text-fg-muted">{member.zones}</span>
            </button>
          </li>
        ))}
      </ul>
      {data.total > MEMBER_PREVIEW && (
        <button
          type="button"
          className="nodrag nopan mt-auto border-t border-line-subtle px-3 py-2 text-left text-2xs font-medium text-fg-link hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-expanded={data.expanded}
          onClick={data.onToggle}
        >
          {data.expanded ? labels.showFewer : labels.showAll(data.total)}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={HIDDEN_HANDLE} />
    </div>
  );
}

const NODE_TYPES = { role: RoleBox };

function boxHeight(total: number, expanded: boolean): number {
  const rows = Math.max(1, visibleCount(total, expanded));
  return HEADER + rows * ROW + (total > MEMBER_PREVIEW ? FOOTER : 0) + PAD;
}

export default function ReportingStructure() {
  const labels = useReportingLabels();
  const userLabels = useUserLabels();
  const gate = useUserGate();
  const { language } = useLanguage();
  const { data, status, error, refetch } = useReportingStructure(gate.canRead);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<FlowSelection>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);

  const roleTitle = useMemo(
    () => (role: ReportingRole) =>
      userLabels.role(role.role_cd, language === "hi-IN" ? (role.label_hi ?? role.label) : role.label),
    [userLabels, language],
  );

  const tree = useMemo(() => roleLadderTree(data ?? [], roleTitle), [data, roleTitle]);

  const memberView = useMemo(
    () => (member: ReportingMember): MemberView => ({
      id: member.id,
      name: displayName(member),
      zones:
        member.zones.length === 0
          ? labels.noZones
          : member.zones
              .map((zone) => (language === "hi-IN" ? (zone.name_hi ?? zone.name) : zone.name))
              .join(", "),
      enabled: member.enabled,
    }),
    [labels, language],
  );

  const subtitleOf = useMemo(
    () => (node: OrgTreeNode<ReportingRole>) => {
      const parent = tree.find((other) => other.id === node.parentId);
      if (parent) return labels.reportsTo(parent.label);
      return node.data.reports_to === null && node.data.level === 0 ? labels.top : labels.unplaced;
    },
    [tree, labels],
  );

  const { nodes, edges } = useMemo(() => {
    const toggle = (id: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };
    const flowNodes: RoleBoxNode[] = tree.map((node) => {
      const open = expanded.has(node.id);
      const total = node.data.members.length;
      return {
        id: node.id,
        type: "role",
        position: { x: 0, y: 0 },
        width: BOX_WIDTH,
        height: boxHeight(total, open),
        data: {
          title: node.label,
          subtitle: subtitleOf(node),
          count: labels.count(total),
          members: node.data.members.slice(0, visibleCount(total, open)).map(memberView),
          total,
          expanded: open,
          onToggle: () => {
            toggle(node.id);
          },
          onOpen: setOpenUser,
          labels,
        },
      };
    });
    const flowEdges: Edge[] = treeEdges(tree).map((edge) => ({
      ...edge,
      type: "smoothstep",
      selectable: false,
    }));
    return {
      nodes: layoutGraph(flowNodes, flowEdges, { direction: "TB", rankSep: 56, nodeSep: 32 }),
      edges: flowEdges,
    };
  }, [tree, expanded, labels, memberView, subtitleOf]);

  if (gate.loading) return <LoadingState label={labels.loading} />;

  if (!gate.canRead) {
    return <EmptyState size="compact" icon="user.password" title={labels.deniedTitle} description={labels.deniedBody} />;
  }

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby="reporting-title">
      <div className="min-w-0">
        <h2 id="reporting-title" className="font-display text-lg font-semibold text-fg-strong">
          {labels.title}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-fg-canvas-muted text-pretty">{labels.subtitle}</p>
        <p className="mt-1 max-w-prose text-2xs text-fg-faint text-pretty">{labels.basis}</p>
      </div>

      {status === "pending" && <LoadingState label={labels.loading} lines={5} />}

      {status === "error" && (
        <ErrorState
          size="compact"
          title={labels.errorTitle}
          description={error.message || labels.errorBody}
          onRetry={() => {
            void refetch();
          }}
          retryLabel={labels.retry}
        />
      )}

      {status === "success" && tree.length === 0 && (
        <EmptyState size="compact" icon="user.group" title={labels.emptyTitle} description={labels.emptyBody} />
      )}

      {status === "success" && tree.length > 0 && (
        <>
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            ariaLabel={labels.chartLabel}
            selection={selection}
            onSelectionChange={setSelection}
            fitKey={`${tree.length}:${[...expanded].join(",")}`}
            minFitZoom={0.5}
          />
          <RoleList tree={tree} labels={labels} memberView={memberView} subtitleOf={subtitleOf} onOpen={setOpenUser} />
        </>
      )}

      <UserDetailSheet
        userId={openUser}
        labels={userLabels}
        canUpdate={gate.canUpdate}
        canDisable={gate.canDisable}
        canSetRoles={gate.canSetRoles}
        canResetPassword={gate.canResetPassword}
        canReadZones={gate.canReadZones}
        canManageZones={gate.canManageZones}
        selfUserId={gate.selfUserId}
        onClose={() => {
          setOpenUser(null);
        }}
      />
    </section>
  );
}

// The chart's content as nested disclosure lists, for keyboard and screen readers.
function RoleList({
  tree,
  labels,
  memberView,
  subtitleOf,
  onOpen,
}: {
  tree: OrgTreeNode<ReportingRole>[];
  labels: ReportingLabels;
  memberView: (member: ReportingMember) => MemberView;
  subtitleOf: (node: OrgTreeNode<ReportingRole>) => string;
  onOpen: (userId: string) => void;
}) {
  return (
    <section aria-labelledby="reporting-list-title" className="flex min-w-0 flex-col gap-2">
      <h3 id="reporting-list-title" className="text-sm font-semibold text-fg-strong">
        {labels.listTitle}
      </h3>
      <ul className="flex flex-col divide-y divide-line-subtle rounded-md border border-line-subtle">
        {tree.map((node) => (
          <li key={node.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                <Icon
                  name="form.chevronRight"
                  className="size-4 shrink-0 text-fg-faint transition-transform group-open:rotate-90"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg-strong">{node.label}</span>
                  <span className="block truncate text-2xs text-fg-muted">{subtitleOf(node)}</span>
                </span>
                <Badge variant="secondary" className="shrink-0 tabular">
                  {labels.count(node.data.members.length)}
                </Badge>
              </summary>
              <ul className="flex flex-col gap-0.5 px-3 pb-2 pl-9">
                {node.data.members.length === 0 && (
                  <li className="py-1 text-2xs text-fg-faint">{labels.noMembers}</li>
                )}
                {node.data.members.map((member) => {
                  const view = memberView(member);
                  return (
                    <li key={member.id} className="flex min-w-0 flex-col py-1">
                      <button
                        type="button"
                        className="w-fit max-w-full truncate rounded-sm text-left text-sm text-fg-link underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        onClick={() => {
                          onOpen(member.id);
                        }}
                      >
                        {view.name}
                      </button>
                      <span className="text-2xs text-fg-muted">
                        {view.zones}
                        {!view.enabled && ` · ${labels.disabled}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
