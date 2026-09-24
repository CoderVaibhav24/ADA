import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon, type IconKey } from "@/lib/icons";

/**
 * Header + rail + content + footer layout.
 *
 * Reconstructed from Figma node 17:3980, which draws the rail in both states:
 * an 82px icon-only rail and a 248px labelled one, with the collapse toggle at
 * the TOP beside the logo.
 *
 * Home: src/routes/ProtectedLayout.tsx, which mounts it around every protected
 * screen. Nothing else in the app renders chrome of its own.
 *
 * **The rail is present at every width.** Below `lg` it is locked to the 82px
 * icon-only shape — not hidden behind a hamburger, and not expandable, because
 * 248px of a 360px screen is not a navigation, it is a takeover. What changes
 * across the breakpoint is labelled versus icon-only, never present versus
 * absent, and the labels stay in the accessibility tree at both widths.
 *
 * Slots, not children-with-conventions: header/nav/footer are props so the
 * shell cannot be assembled wrongly, and so it holds no English.
 */
export type AppShellProps = {
  /** The rail's entries. One node, rendered once. */
  nav: ReactNode;
  /** Top bar contents: page title, notifications, language, account pill. */
  header?: ReactNode;
  /** Brand block, pinned above the nav beside the collapse toggle. */
  brand?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Only honoured at `lg` and above; below it the rail is always collapsed. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * Hand the child the whole main area: no gutter, no 1440 max-width, and a
   * `main` that is a min-height-0 flex column so a full-height child can size
   * itself against it.
   *
   * For the change-detection console, which is a map that owns the viewport and
   * scrolls its own panels. Every designed screen is `container` (the default),
   * because Figma frames them all at 1440 with a gutter.
   */
  bleed?: boolean;
  /** Accessible names. Required: the shell ships no English. */
  labels: {
    collapseNavigation: string;
    expandNavigation: string;
    navigationLandmark: string;
    skipToContent: string;
  };
  className?: string;
};

export function AppShell({
  nav,
  header,
  brand,
  footer,
  children,
  collapsed: collapsedProp,
  onCollapsedChange,
  bleed = false,
  labels,
  className,
}: AppShellProps) {
  const [internal, setInternal] = useState(false);
  const collapsed = collapsedProp ?? internal;
  const setCollapsed = onCollapsedChange ?? setInternal;

  return (
    <div
      data-slot="app-shell"
      data-collapsed={collapsed}
      className={cn(
        // Pinned to the viewport: the rail never scrolls, only the content
        // column to its right does (it carries overflow-y-auto below).
        "relative flex h-dvh w-full flex-col overflow-hidden bg-surface-canvas bg-(image:--canvas-glow) bg-no-repeat text-foreground",
        className,
      )}
    >
      {/* First tabbable element on every page. Visually hidden until focused. */}
      <a
        href="#icms-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-popover focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        {labels.skipToContent}
      </a>

      <div className="flex min-h-0 flex-1">
        <aside
          data-slot="app-rail"
          className={cn(
            "flex w-rail shrink-0 flex-col border-r border-sidebar-border bg-surface-rail text-sidebar-foreground backdrop-blur-md",
            "transition-[width] duration-slow ease-standard",
            // 82px and 248px are both measured off the Figma frames. The wide
            // one is reachable only at `lg`.
            !collapsed && "lg:w-sidebar",
          )}
        >
          <div
            className={cn(
              "flex shrink-0 flex-col items-center gap-1 px-2 py-3",
              !collapsed && "lg:flex-row lg:items-center lg:gap-2 lg:px-3",
            )}
          >
            {brand}
            {/* Top of the rail, beside the logo — where Figma puts it. Hidden
                below `lg`, where there is no wide state to toggle to. */}
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden shrink-0 lg:inline-flex"
              aria-label={collapsed ? labels.expandNavigation : labels.collapseNavigation}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <Icon name={collapsed ? "nav.expand" : "nav.collapse"} className="size-4" />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <nav aria-label={labels.navigationLandmark} className="px-2 pb-4">
              {nav}
            </nav>
          </ScrollArea>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* min-w-0 so a long page title truncates inside the header instead of
              pushing the account pill off-screen at 360px. */}
          <header className="z-30 flex h-header shrink-0 items-center gap-2 border-b border-line-subtle bg-surface-2 px-3 backdrop-blur-sm sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">{header}</div>
          </header>

          {bleed ? (
            // No scroller here: a bleed page such as the map decides what
            // scrolls, so it never fights an outer scrollbar.
            <main id="icms-main" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {children}
            </main>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <main id="icms-main" className="min-w-0 flex-1">
                <div className="mx-auto w-full max-w-(--layout-content-max) px-3 py-4 sm:px-6 sm:py-6">
                  {children}
                </div>
              </main>

              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A single rail entry.
 *
 * `collapsed` is the DESKTOP state only. Below `lg` the entry is icon-only
 * whatever it says, because the rail itself is. The label is never
 * `display:none` — it stays sr-only, so the collapsed rail is still navigable
 * by screen reader and the icon is not the only name the entry has.
 */
export function AppShellNavItem({
  icon,
  label,
  active,
  collapsed,
  badge,
  onClick,
  href,
  className,
}: {
  icon: IconKey;
  label: ReactNode;
  active?: boolean;
  collapsed?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const shared = {
    "data-active": active,
    "aria-current": active ? ("page" as const) : undefined,
    className: cn(
      // 44px tall at every width: this is the control a field officer taps.
      "group relative flex min-h-11 w-full items-center justify-center gap-3 rounded-md px-0 text-sm",
      "transition-colors duration-fast ease-standard",
      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      active
        ? "bg-sidebar-accent text-sidebar-primary font-medium"
        : "text-sidebar-foreground",
      !collapsed && "lg:justify-start lg:px-3",
      className,
    ),
  };

  const inner = (
    <>
      <Icon name={icon} className="size-5 shrink-0" />
      <span
        className={cn(
          "sr-only min-w-0 flex-1 truncate text-start",
          !collapsed && "lg:not-sr-only",
        )}
      >
        {label}
      </span>
      {badge != null && (
        <span
          className={cn(
            "absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-2xs text-destructive-foreground tabular",
            !collapsed && "lg:static lg:size-auto lg:min-w-4 lg:px-1",
          )}
        >
          {badge}
        </span>
      )}
    </>
  );

  return href ? (
    <a href={href} {...shared}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} {...shared}>
      {inner}
    </button>
  );
}
