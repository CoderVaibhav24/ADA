/**
 * `/administration/users` — the officer register, and the gate in front of it.
 *
 * ## Where gating happens, and what each place is worth
 *
 * The same three places `PolicyAdmin` documents, with `user.*` in them:
 *
 *   1. the rail and the route — `officers.access` draws the entry and opens the screen;
 *   2. here — the register needs `user.read`, and each write control is
 *      disabled without its own code: `user.create`, `user.update`,
 *      `user.disable`, `user.roles`, `user.password`;
 *   3. **ada-api** — `require_permission` on all six endpoints.
 *
 * Only (3) enforces anything. `/me/capabilities` says `advisory: true` in its
 * own payload for exactly this reason: 1 and 2 decide which doors are drawn, 3
 * decides which ones open.
 *
 * ## What this register cannot filter, and why
 *
 * `GET /admin/users` takes `page`, `size`, `sort` and `q` and nothing else —
 * `UserQuery` extends `CollectionParams`, which forbids extras, so an invented
 * parameter is a 422 rather than a filter. Two consequences the screen states
 * instead of faking:
 *
 *   - **sign-in state is filtered on the page, not on the register.** The note
 *     under the control says so and names both counts, and the pagination goes
 *     on reporting the server's own total, because that is what it is.
 *   - **there is no role filter at all.** Keycloak returns no role mappings
 *     with a user list, so `UserRow` has no roles to filter on, and fetching
 *     them would be one extra round trip per row. Roles are on the detail
 *     panel, where they are authoritative.
 *
 * ## No export button
 *
 * Every other register in this portal has one. This one does not, deliberately:
 * `policy.py` seeds `case.export` and no `user.export`, so a CSV of the whole
 * officer roster with email addresses in it would be a capability the server
 * never sanctioned and cannot refuse. If the roster should be exportable, the
 * permission is the thing to add first.
 */

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { UserListQuery, UserRow } from "@/api/icms/users";
import { useRegisterState } from "@/components/data-table/register-state";
import type { RegisterState } from "@/components/data-table/types";
import { RegisterPagination } from "@/components/icms/RegisterPagination";
import { EmptyState, NoResultsState, TableLoadingRows } from "@/components/icms/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFormats } from "@/i18n";
import { usePaginationLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { useUserLabels, type UserLabels } from "./labels";
import { displayName } from "./officer";
import { Code, SignInState, UserLoadError } from "./parts";
import UserCreateDialog from "./UserCreateDialog";
import UserDetailSheet from "./UserDetailSheet";
import { useUserGate, useUserList } from "./useUsers";

/** Keycloak orders by username and offers no other key, so sort is not a control. */
const DEFAULT_STATE: RegisterState = {
  page: 1,
  size: 25,
  sort: "username",
  q: "",
  filters: {},
  hiddenColumns: [],
};

const STATE_KEY = "enabled";
const COLUMN_COUNT = 6;

type SignInFilter = "all" | "enabled" | "disabled";

function toSignInFilter(raw: string | undefined): SignInFilter {
  return raw === "enabled" || raw === "disabled" ? raw : "all";
}

export default function UserAdministration() {
  const labels = useUserLabels();
  const gate = useUserGate();
  const formats = useFormats();
  const paginationLabels = usePaginationLabels();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const { state, setState, searchValue, setSearchValue, clearFilters, isFiltered } =
    useRegisterState({ defaults: DEFAULT_STATE, facetKeys: [STATE_KEY] });

  const signIn = toSignInFilter(state.filters[STATE_KEY]?.[0]);

  const query = useMemo<UserListQuery>(
    () => ({
      page: state.page,
      size: state.size,
      ...(state.q === "" ? {} : { q: state.q }),
    }),
    [state.page, state.size, state.q],
  );

  const { data, status, error, isFetching, refetch } = useUserList(query);

  const pageRows = data?.items ?? [];
  // Client-side, on the page only — the endpoint has no `enabled` parameter.
  const rows =
    signIn === "all"
      ? pageRows
      : pageRows.filter((row) => row.enabled === (signIn === "enabled"));

  const openUser = params.get("user");

  // Opening pushes, so Back closes the panel; closing REPLACES, so Back does
  // not reopen what the admin has just dismissed.
  const selectUser = (userId: string | null) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (userId === null) next.delete("user");
        else next.set("user", userId);
        return next;
      },
      { replace: userId === null },
    );
  };

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
          <p className="mt-1 max-w-prose text-sm text-fg-canvas-muted text-pretty">
            {labels.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link to={ROUTES.administration}>
              <Icon name="user.role" className="size-4" />
              {labels.policyLink}
            </Link>
          </Button>
          <Button
            disabled={!gate.canCreate}
            title={gate.canCreate ? undefined : labels.register.createDenied}
            onClick={() => {
              setCreating(true);
            }}
          >
            <Icon name="action.add" className="size-4" />
            {labels.register.create}
          </Button>
        </div>
      </header>

      <p className="max-w-prose text-2xs text-fg-faint text-pretty">{labels.advisory}</p>

      <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-fg-strong">
            {labels.register.title}
          </h2>
          {status === "success" && (
            <span className="text-sm text-fg-muted tabular">
              {labels.register.count(data.total)}
            </span>
          )}
        </header>

        {/* The filter row, above the table, as every other register draws it. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 grow flex-col gap-1.5 sm:max-w-sm">
            <Label htmlFor="officer-search">{labels.register.searchLabel}</Label>
            <div className="relative">
              <Icon
                name="nav.search"
                className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint"
              />
              <Input
                id="officer-search"
                type="search"
                className="ps-8"
                value={searchValue}
                placeholder={labels.register.searchPlaceholder}
                aria-describedby="officer-search-hint"
                onChange={(event) => {
                  setSearchValue(event.target.value);
                }}
              />
            </div>
            <p id="officer-search-hint" className="text-2xs text-fg-faint text-pretty">
              {labels.register.searchHint}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="officer-state">{labels.register.stateLabel}</Label>
            <Select
              value={signIn}
              onValueChange={(next) => {
                setState({
                  filters: {
                    ...state.filters,
                    [STATE_KEY]: next === "all" ? [] : [next],
                  },
                });
              }}
            >
              <SelectTrigger id="officer-state" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{labels.register.stateAll}</SelectItem>
                <SelectItem value="enabled">{labels.register.stateEnabled}</SelectItem>
                <SelectItem value="disabled">{labels.register.stateDisabled}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isFiltered && (
            <Button variant="ghost" onClick={clearFilters}>
              <Icon name="action.clear" className="size-4" />
              {labels.register.clear}
            </Button>
          )}
        </div>

        {signIn !== "all" && status === "success" && (
          <p className="flex items-start gap-2 rounded-md border border-line-subtle bg-surface-2 p-3 text-2xs text-fg-muted">
            <Icon name="feedback.info" className="mt-0.5 size-3.5 shrink-0" />
            <span className="text-pretty">
              {labels.register.stateNote(rows.length, pageRows.length)}
            </span>
          </p>
        )}

        <p className="max-w-prose text-2xs text-fg-faint text-pretty">
          {labels.register.roleNote}
        </p>

        {status === "error" ? (
          <UserLoadError
            error={error}
            labels={labels}
            onRetry={() => {
              void refetch();
            }}
          />
        ) : (
          // Two layers, as components/data-table/DataTable.tsx does it: the
          // OUTER overflow-hidden stops a table wider than the viewport giving
          // the whole page a sideways scrollbar. `<Table>` is the inner
          // scroller, so at tablet the register scrolls rather than reflowing.
          <div className="min-w-0 overflow-hidden rounded-md border border-line-subtle">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{labels.register.columns.officer}</TableHead>
                  <TableHead>{labels.register.columns.username}</TableHead>
                  <TableHead>{labels.register.columns.email}</TableHead>
                  <TableHead>{labels.register.columns.signIn}</TableHead>
                  <TableHead>{labels.register.columns.created}</TableHead>
                  <TableHead className="text-end">
                    <span className="sr-only">{labels.register.columns.manage}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status === "pending" && <TableLoadingRows columns={COLUMN_COUNT} rows={6} />}

                {status === "success" && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMN_COUNT}>
                      {isFiltered || signIn !== "all" ? (
                        <NoResultsState
                          size="compact"
                          title={labels.register.noResultsTitle}
                          description={labels.register.noResultsBody}
                          action={
                            <Button variant="outline" size="sm" onClick={clearFilters}>
                              {labels.register.clear}
                            </Button>
                          }
                        />
                      ) : (
                        <EmptyState
                          size="compact"
                          title={labels.register.emptyTitle}
                          description={labels.register.emptyBody}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )}

                {status === "success" &&
                  rows.map((row) => (
                    <OfficerRow
                      key={row.id}
                      row={row}
                      labels={labels}
                      isSelf={row.id === gate.selfUserId}
                      dateTime={formats.dateTime}
                      onOpen={() => {
                        selectUser(row.id);
                      }}
                    />
                  ))}
              </TableBody>
            </Table>
          </div>
        )}

        {status === "success" && (
          <RegisterPagination
            page={state.page}
            pageSize={state.size}
            total={data.total}
            labels={paginationLabels}
            disabled={isFetching}
            onPageChange={(page) => {
              setState({ page });
            }}
            onPageSizeChange={(size) => {
              setState({ size });
            }}
          />
        )}
      </section>

      <UserCreateDialog
        open={creating}
        onOpenChange={setCreating}
        labels={labels}
        canCreate={gate.canCreate}
        onCreated={(user) => {
          selectUser(user.id);
        }}
      />

      <UserDetailSheet
        userId={openUser}
        labels={labels}
        canUpdate={gate.canUpdate}
        canDisable={gate.canDisable}
        canSetRoles={gate.canSetRoles}
        canResetPassword={gate.canResetPassword}
        canReadZones={gate.canReadZones}
        canManageZones={gate.canManageZones}
        selfUserId={gate.selfUserId}
        onClose={() => {
          selectUser(null);
        }}
      />
    </div>
  );
}

function OfficerRow({
  row,
  labels,
  isSelf,
  dateTime,
  onOpen,
}: {
  row: UserRow;
  labels: UserLabels;
  isSelf: boolean;
  dateTime: (value: string) => string;
  onOpen: () => void;
}) {
  const name = displayName(row);
  return (
    <TableRow>
      <TableCell className="font-medium text-fg-strong">
        <span className="flex flex-wrap items-center gap-2">
          {row.first_name == null && row.last_name == null ? (
            <span className="text-fg-muted">{labels.register.noName}</span>
          ) : (
            name
          )}
          {isSelf && <Badge variant="secondary">{labels.register.self}</Badge>}
        </span>
      </TableCell>
      <TableCell>
        <Code>{row.username}</Code>
      </TableCell>
      <TableCell className="text-fg-muted">
        {row.email == null ? (
          <span className="text-fg-faint">{labels.register.noEmail}</span>
        ) : (
          <span className="flex flex-col gap-0.5">
            <span className="break-all">{row.email}</span>
            {/* Stated in words, not as a coloured dot: verification is a fact an
                officer may have to repeat down a phone. */}
            <span className="text-2xs text-fg-faint">
              {row.email_verified
                ? labels.register.emailVerified
                : labels.register.emailUnverified}
            </span>
          </span>
        )}
      </TableCell>
      <TableCell>
        <SignInState enabled={row.enabled} labels={labels} />
      </TableCell>
      <TableCell className="text-fg-muted tabular">
        {row.created_at == null ? labels.register.noDate : dateTime(row.created_at)}
      </TableCell>
      <TableCell className="text-end">
        <Button
          variant="outline"
          size="sm"
          aria-label={labels.register.manageLabel(name)}
          onClick={onOpen}
        >
          <Icon name="action.edit" className="size-4" />
          {labels.register.manage}
        </Button>
      </TableCell>
    </TableRow>
  );
}
