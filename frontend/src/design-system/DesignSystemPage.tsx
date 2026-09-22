import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Icon,
  ICON_SETS,
  IconSetProvider,
  DEFAULT_ICON_SET,
  type IconSetId,
} from "@/lib/icons";
import { useTheme, type Theme } from "@/lib/theme";
import { Gallery } from "./Gallery";

type Mode = Theme | "split";

const SECTIONS = [
  ["colour", "Colour"],
  ["type", "Typography"],
  ["scale", "Scale"],
  ["icons", "Icons"],
  ["status", "Status"],
  ["patterns", "Authored"],
  ["primitives", "Primitives"],
] as const;

export default function DesignSystemPage() {
  const { theme, setTheme } = useTheme();
  const [mode, setMode] = useState<Mode>("dark");
  const [iconSet, setIconSet] = useState<IconSetId>(DEFAULT_ICON_SET);

  const applyMode = (next: Mode) => {
    setMode(next);
    setTheme(next === "light" ? "light" : "dark");
  };

  return (
    <IconSetProvider set={iconSet}>
      <div className="min-h-dvh bg-surface-canvas text-foreground">
        <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-1/95 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Icon
                name="map.encroachment"
                className="size-6 shrink-0 text-accent-solid"
              />
              <div className="min-w-0">
                <h1 className="truncate font-display text-md font-bold text-fg-strong">
                  ICMS Design System
                </h1>
                <p className="truncate text-2xs text-fg-faint">
                  Figma hSyLFWm2yjSU5iZ6Jw0eRa · 5 published variables, everything else
                  derived
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-2xs tracking-wider text-fg-faint uppercase">
                  Theme
                </span>
                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(v) => v && applyMode(v as Mode)}
                  variant="outline"
                  size="sm"
                >
                  <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
                  <ToggleGroupItem value="light">Light</ToggleGroupItem>
                  <ToggleGroupItem value="split">Split</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <span className="text-2xs tracking-wider text-fg-faint uppercase">
                  Icon set
                </span>
                <ToggleGroup
                  type="single"
                  value={iconSet}
                  onValueChange={(v) => v && setIconSet(v as IconSetId)}
                  variant="outline"
                  size="sm"
                >
                  {(Object.keys(ICON_SETS) as IconSetId[]).map((id) => (
                    <ToggleGroupItem key={id} value={id} aria-label={ICON_SETS[id].label}>
                      <Icon name="nav.map" set={id} className="size-4" />
                      <span className="hidden sm:inline">{ICON_SETS[id].label}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>

            <nav className="flex flex-wrap items-center gap-1">
              {SECTIONS.map(([id, label]) => (
                <Button key={id} variant="ghost" size="xs" asChild>
                  <a href={`#${id}`}>{label}</a>
                </Button>
              ))}
            </nav>
          </div>

          <div className="border-t border-line-subtle px-5 py-1.5">
            <p className="text-2xs text-fg-faint">
              Active icon set <code className="font-mono text-fg-muted">{iconSet}</code>{" "}
              · {ICON_SETS[iconSet].license}, attribution{" "}
              {ICON_SETS[iconSet].attributionRequired ? "required" : "not required"} ·
              bundled offline, no runtime API calls · page theme{" "}
              <code className="font-mono text-fg-muted">{theme}</code>
            </p>
          </div>
        </header>

        {mode === "split" ? (
          <div className="grid grid-cols-1 xl:grid-cols-2">
            <div data-theme="dark" className="min-w-0 border-e border-line-subtle">
              <ThemeBanner label='data-theme="dark" — the default; :root carries these values' />
              <Gallery />
            </div>
            <div data-theme="light" className="min-w-0">
              <ThemeBanner label='data-theme="light" — same contract, inverted surface stack' />
              <Gallery />
            </div>
          </div>
        ) : (
          <Gallery />
        )}

        <Toaster position="bottom-right" />
      </div>
    </IconSetProvider>
  );
}

function ThemeBanner({ label, className }: { label: string; className?: string }) {
  return (
    <p
      className={cn(
        "sticky top-0 z-20 bg-surface-sunken px-5 py-2 font-mono text-2xs text-fg-muted",
        className,
      )}
    >
      {label}
    </p>
  );
}
