import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import type { User } from "oidc-client-ts";

import { AppShell, AppShellNavItem } from "@/components/icms/AppShell";
import { Footer } from "@/components/icms/Footer";
import { NotificationBell } from "@/components/icms/NotificationBell";
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
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useNavLabels, useShellLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";

import { useCapabilityGate } from "@/features/policy/usePolicy";

import { currentUser, logout } from "../auth/oidc";
import ErrorBoundary from "./ErrorBoundary";
import {
  PRIMARY_NAV,
  activeNavId,
  isBleedPath,
  isNavLink,
  navForPermissions,
} from "./nav";
import { LOGIN_PATH, ROOT_PATH } from "./paths";

const COLLAPSED_KEY = "icms.nav.collapsed";

// localStorage throws outright in a private window, so the preference is optional.
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The person, not the mailbox.
 *
 * `auth/oidc.ts` `displayName` prefers `email`, which renders as a truncated
 * `officer@pcsmcpl…` in a 200px pill. This reads the name claims first and only
 * falls back to the local-part of an address when the token carries nothing else.
 */
function profileName(user: User | null): string {
  const profile = user?.profile as Record<string, unknown> | undefined;
  const claim = (key: string): string => {
    const value = profile?.[key];
    return typeof value === "string" ? value.trim() : "";
  };

  const full = claim("name");
  if (full) return full;

  const given = claim("given_name");
  const family = claim("family_name");
  if (given || family) return [given, family].filter(Boolean).join(" ");

  const preferred = claim("preferred_username");
  if (preferred && !preferred.includes("@")) return preferred;

  const address = claim("email") || preferred;
  return address ? (address.split("@")[0] ?? "") : "";
}

// One letter, from the same name the pill shows. Returns "" rather than "?" when the
// profile has not loaded — a placeholder glyph reads as the officer's actual initial.
function avatarInitial(name: string): string {
  const first = name.trim().replace(/^[^\p{L}\p{N}]+/u, "").charAt(0);
  return first ? first.toLocaleUpperCase() : "";
}

export default function ProtectedLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Permissions, not realm roles: the roles holding `policy.read` are editable
  // from the Administration screen, so a rail keyed to `super-admin` would be
  // wrong the first time somebody used it.
  const { loading: capabilitiesLoading, permissions } = useCapabilityGate();
  const shellLabels = useShellLabels();
  const navLabels = useNavLabels();

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

  // Guarded: the rail's Logout is a plain button, and a double tap would
  // otherwise start two sign-outs and race the redirect.
  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const outcome = await logout();
      if (outcome === "local") {
        void navigate(`${LOGIN_PATH}?signedout=1`, { replace: true });
      }
    } finally {
      setSigningOut(false);
    }
  }, [navigate, signingOut]);

  const go = useCallback(
    (path: string) => {
      void navigate(path);
    },
    [navigate],
  );

  const active = activeNavId(location.pathname);
  const bleed = isBleedPath(location.pathname);
  const name = profileName(user);

  const brand = (
    <button
      type="button"
      onClick={() => go(ROOT_PATH)}
      aria-label={shellLabels.brandHome}
      className={`flex min-w-0 flex-col items-center gap-1 rounded-md px-1 py-1 transition-colors duration-fast ease-standard hover:bg-sidebar-accent ${
        collapsed ? "" : "lg:w-full lg:flex-row lg:gap-2 lg:text-start"
      }`}
    >
      <img
        src="/logo-mcpl.svg"
        alt={shellLabels.brandLogoAlt}
        className="size-8 shrink-0"
      />
      {/* The short mark under the logo on the narrow rail, as Figma draws it. */}
      <span
        className={`block max-w-full truncate font-display text-2xs font-bold tracking-wide ${
          collapsed ? "" : "lg:hidden"
        }`}
      >
        {shellLabels.brandName}
      </span>
      <span className={`hidden min-w-0 flex-1 ${collapsed ? "" : "lg:block"}`}>
        <span className="block truncate font-display text-lg leading-none font-bold tracking-wide">
          {shellLabels.brandName}
        </span>
        <span className="block truncate text-2xs text-sidebar-foreground/70">
          {shellLabels.brandTagline}
        </span>
      </span>
    </button>
  );

  // Every rail entry is gated, so while capabilities load the rail would be empty.
  const nav = capabilitiesLoading ? (
    <p
      role="status"
      aria-label={shellLabels.navLoading}
      className="flex items-center justify-center gap-2 px-2 py-3 text-2xs text-sidebar-foreground/70"
    >
      <Icon name="feedback.loading" spin className="size-4 shrink-0" />
      <span className={`hidden truncate ${collapsed ? "" : "lg:inline"}`}>
        {shellLabels.navLoading}
      </span>
    </p>
  ) : (
    <ul className="flex flex-col gap-1">
      {navForPermissions(PRIMARY_NAV, permissions).map((item) => (
        <li
          key={item.id}
          className={
            item.separatorBefore ? "mt-2 border-t border-sidebar-border pt-2" : undefined
          }
        >
          <AppShellNavItem
            icon={item.icon}
            label={navLabels[item.id]}
            active={isNavLink(item) && active === item.id}
            collapsed={collapsed}
            onClick={() => {
              if (isNavLink(item)) go(item.path);
              else void handleSignOut();
            }}
          />
        </li>
      ))}
    </ul>
  );

  const header = (
    <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
      <NotificationBell ariaLabel={shellLabels.notificationsLabel} />

      <LanguageSwitcher />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="max-w-[12rem] gap-2"
            aria-label={shellLabels.accountMenu}
          >
            <Avatar className="size-6 shrink-0">
              <AvatarFallback className="text-2xs">{avatarInitial(name)}</AvatarFallback>
            </Avatar>
            <span className="hidden min-w-0 truncate sm:inline">{name}</span>
            <Icon name="form.chevronDown" className="size-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="text-2xs font-normal text-fg-muted">
              {shellLabels.signedInAs}
            </span>
            <span className="truncate">{name}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={signingOut} onSelect={() => void handleSignOut()}>
            <Icon name="nav.logout" className="size-4" />
            {signingOut ? shellLabels.signingOut : shellLabels.signOut}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <AppShell
      brand={brand}
      nav={nav}
      header={header}
      bleed={bleed}
      collapsed={collapsed}
      onCollapsedChange={handleCollapsedChange}
      labels={shellLabels}
      footer={
        bleed ? undefined : (
          <Footer
            copyright={shellLabels.copyright(new Date().getFullYear())}
            support={shellLabels.operatedBy}
          />
        )
      }
    >
      <ErrorBoundary resetKey={location.key}>
        {bleed ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <Outlet />
          </div>
        ) : (
          <Outlet />
        )}
      </ErrorBoundary>
    </AppShell>
  );
}
