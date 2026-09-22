import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon, type IconKey } from "@/lib/icons";

/**
 * Header + sidebar + content + footer layout.
 *
 * Reconstructed from the shared shell every portal screen in Figma copies by
 * hand: an 82px icon rail (the one genuine component in the file, `Frame 12`,
 * instanced 10x), a 64px top bar with the bell and the account pill, and the
 * page body. Figma's rail expands to a 248px labelled nav on the dashboard, so
 * both widths are real and `collapsed` switches between them.
 *
 * Home: src/routes/ProtectedLayout.tsx, which mounts it around every protected
 * screen. Nothing else in the app renders chrome of its own.
 *
 * Responsive to 360px. Below `lg` the rail is not squeezed — it moves into a
 * Sheet behind a menu button, because an 82px rail plus a table at 360px
 * leaves 278px of grid, which is unusable. The Sheet renders the same `nav`
 * node, so there is no second navigation to keep in sync.
 *
 * Slots, not children-with-conventions: header/nav/footer are props so the
 * shell cannot be assembled wrongly, and so it holds no English.
 */
export type AppShellProps = {
  /** The icon rail / labelled nav. Same node in both the aside and the Sheet. */
  nav: ReactNode;
  /** Top bar contents: page title, search, bell, account pill. */
  header?: ReactNode;
  /** Brand block, pinned above the nav. */
  brand?: ReactNode;
  /** Pinned below the nav — the account card Figma puts at the rail's foot. */
  navFooter?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * The Sheet that stands in for the rail below `lg`. Uncontrolled by default;
   * supply the pair — same idiom as `collapsed`/`onCollapsedChange` — when the
   * caller has to close it itself. A router-driven nav must: navigating does
   * not dismiss a Radix Sheet, so at 360px the menu would stay open on top of
   * the screen it just moved to.
   */
  mobileNavOpen?: boolean;
  onMobileNavOpenChange?: (open: boolean) => void;
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
    openNavigation: string;
    closeNavigation: string;
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
  navFooter,
  footer,
  children,
  collapsed: collapsedProp,
  onCollapsedChange,
  mobileNavOpen,
  onMobileNavOpenChange,
  bleed = false,
  labels,
  className,
}: AppShellProps) {
  const [internal, setInternal] = useState(false);
  const collapsed = collapsedProp ?? internal;
  const setCollapsed = onCollapsedChange ?? setInternal;
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);
  const mobileOpen = mobileNavOpen ?? internalMobileOpen;
  const setMobileOpen = onMobileNavOpenChange ?? setInternalMobileOpen;

  const navBody = (
    <div className="flex min-h-0 flex-1 flex-col">
      {brand && <div className="shrink-0 px-3 py-4">{brand}</div>}
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label={labels.navigationLandmark} className="px-2 pb-4">
          {nav}
        </nav>
      </ScrollArea>
      {navFooter && (
        <div className="shrink-0 border-t border-sidebar-border p-3">{navFooter}</div>
      )}
    </div>
  );

  return (
    <div
      data-slot="app-shell"
      data-collapsed={collapsed}
      className={cn(
        "flex min-h-dvh w-full flex-col bg-surface-canvas text-foreground",
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
        {/* Desktop rail. Hidden below lg; the Sheet takes over. */}
        <aside
          className={cn(
            "hidden shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col",
            "transition-[width] duration-slow ease-standard",
            // Width is a token, not a magic number: 82px and 248px are both
            // measured off the Figma frames.
            collapsed ? "w-rail" : "w-sidebar",
          )}
        >
          {navBody}
          <div className="shrink-0 border-t border-sidebar-border p-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="w-full"
              aria-label={collapsed ? labels.expandNavigation : labels.collapseNavigation}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <Icon name={collapsed ? "nav.expand" : "nav.collapse"} className="size-4" />
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-header shrink-0 items-center gap-2 border-b border-line-subtle bg-surface-1/95 px-3 backdrop-blur-sm sm:px-4">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="lg:hidden"
                  aria-label={mobileOpen ? labels.closeNavigation : labels.openNavigation}
                >
                  <Icon name="nav.menu" className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[min(18rem,85vw)] bg-sidebar p-0 text-sidebar-foreground"
              >
                <SheetTitle className="sr-only">{labels.navigationLandmark}</SheetTitle>
                {navBody}
              </SheetContent>
            </Sheet>

            {/* min-w-0 so a long page title truncates inside the header instead
                of pushing the account pill off-screen at 360px. */}
            <div className="flex min-w-0 flex-1 items-center gap-3">{header}</div>
          </header>

          <main
            id="icms-main"
            className={cn("min-w-0 flex-1", bleed && "flex min-h-0 flex-col")}
          >
            {bleed ? (
              children
            ) : (
              <div className="mx-auto w-full max-w-(--layout-content-max) px-3 py-4 sm:px-6 sm:py-6">
                {children}
              </div>
            )}
          </main>

          {footer}
        </div>
      </div>
    </div>
  );
}

/**
 * A single rail entry. Collapses to icon-only, keeping the label in the
 * accessibility tree (sr-only, not display:none) so the collapsed rail is
 * still navigable by screen reader.
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
      "group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-fast ease-standard",
      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      active
        ? "bg-sidebar-accent text-sidebar-primary font-medium"
        : "text-sidebar-foreground",
      collapsed && "justify-center px-0",
      className,
    ),
  };

  const inner = (
    <>
      <Icon name={icon} className="size-5 shrink-0" />
      <span className={cn("min-w-0 flex-1 truncate text-start", collapsed && "sr-only")}>
        {label}
      </span>
      {badge != null && (
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-destructive text-2xs text-destructive-foreground tabular",
            collapsed ? "absolute top-1 right-1 size-4" : "min-w-4 px-1",
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
