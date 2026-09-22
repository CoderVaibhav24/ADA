import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import type { User } from "oidc-client-ts";

import { AppShell, AppShellNavItem } from "@/components/icms/AppShell";
import { Footer } from "@/components/icms/Footer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/lib/icons";

import { currentUser, displayName, logout } from "../auth/oidc";
import { useRoles } from "../auth/roles";
import ErrorBoundary from "./ErrorBoundary";
import { navLabelsEn, shellLabelsEn } from "./labels.en";
import { PRIMARY_NAV, activeNavId, isBleedPath, navForRoles } from "./nav";
import { HOME_PATH, LOGIN_PATH } from "./paths";

const COLLAPSED_KEY = "icms.nav.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

export default function ProtectedLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { roles } = useRoles();

  useEffect(() => {
    void currentUser().then(setUser);
  }, []);

  const handleCollapsedChange = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      const outcome = await logout();
      if (outcome === "local") {
        void navigate(`${LOGIN_PATH}?signedout=1`, { replace: true });
      }
    } finally {
      setSigningOut(false);
    }
  }, [navigate]);

  const go = useCallback(
    (path: string) => {
      void navigate(path);
      setMobileNavOpen(false);
    },
    [navigate],
  );

  const active = activeNavId(location.pathname);
  const bleed = isBleedPath(location.pathname);
  const name = displayName(user);

  const brand = (
    <button
      type="button"
      onClick={() => go(HOME_PATH)}
      aria-label={shellLabelsEn.brandHome}
      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-start transition-colors duration-fast ease-standard hover:bg-sidebar-accent"
    >
      <img
        src="/logo-mcpl.svg"
        alt={shellLabelsEn.brandLogoAlt}
        className="size-8 shrink-0"
      />
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg leading-none font-bold tracking-wide">
            {shellLabelsEn.brandName}
          </span>
          <span className="block truncate text-2xs text-sidebar-foreground/70">
            {shellLabelsEn.brandTagline}
          </span>
        </span>
      )}
    </button>
  );

  const nav = (
    <ul className="flex flex-col gap-1">
      {navForRoles(PRIMARY_NAV, roles).map((item) => (
        <li key={item.id}>
          <AppShellNavItem
            icon={item.icon}
            label={navLabelsEn[item.id]}
            active={active === item.id}
            collapsed={collapsed}
            onClick={() => go(item.path)}
          />
        </li>
      ))}
    </ul>
  );

  const navFooter = (
    <div
      className={
        collapsed ? "flex flex-col items-center gap-2" : "flex items-center gap-2"
      }
    >
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="text-2xs">{initials(name)}</AvatarFallback>
      </Avatar>
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="block text-2xs text-sidebar-foreground/70">
            {shellLabelsEn.signedInAs}
          </span>
          <span className="block truncate text-xs font-medium" title={name}>
            {name}
          </span>
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={signingOut}
        aria-label={shellLabelsEn.signOut}
        title={shellLabelsEn.signOut}
        onClick={() => void handleSignOut()}
      >
        <Icon name="nav.logout" className="size-4" />
      </Button>
    </div>
  );

  const header = (
    <>
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <img
          src="/logo-mcpl.svg"
          alt={shellLabelsEn.brandLogoAlt}
          className="size-6 shrink-0"
        />
        <span className="truncate font-display text-base font-bold tracking-wide">
          {shellLabelsEn.brandName}
        </span>
      </div>

      <div className="ms-auto flex shrink-0 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="max-w-[12rem] gap-2"
              aria-label={shellLabelsEn.accountMenu}
            >
              <Avatar className="size-6 shrink-0">
                <AvatarFallback className="text-2xs">{initials(name)}</AvatarFallback>
              </Avatar>
              <span className="hidden min-w-0 truncate sm:inline">{name}</span>
              <Icon name="form.chevronDown" className="size-4 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-2xs font-normal text-fg-muted">
                {shellLabelsEn.signedInAs}
              </span>
              <span className="truncate">{name}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={signingOut}
              onSelect={() => void handleSignOut()}
            >
              <Icon name="nav.logout" className="size-4" />
              {signingOut ? shellLabelsEn.signingOut : shellLabelsEn.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  return (
    <AppShell
      brand={brand}
      nav={nav}
      navFooter={navFooter}
      header={header}
      bleed={bleed}
      collapsed={collapsed}
      onCollapsedChange={handleCollapsedChange}
      mobileNavOpen={mobileNavOpen}
      onMobileNavOpenChange={setMobileNavOpen}
      labels={shellLabelsEn}
      footer={
        bleed ? undefined : (
          <Footer
            copyright={shellLabelsEn.copyright(new Date().getFullYear())}
            support={shellLabelsEn.operatedBy}
          />
        )
      }
    >
      <ErrorBoundary resetKey={location.key}>
        {bleed ? (
          <div className="h-[calc(100dvh-var(--spacing-header))] min-h-0">
            <Outlet />
          </div>
        ) : (
          <Outlet />
        )}
      </ErrorBoundary>
    </AppShell>
  );
}
