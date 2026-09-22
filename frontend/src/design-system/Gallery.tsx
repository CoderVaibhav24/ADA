import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DatePicker, DateRangePicker } from "@/components/ui/date-picker";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarTrigger } from "@/components/ui/menubar";
import { NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger } from "@/components/ui/navigation-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { AppShell, AppShellNavItem } from "@/components/icms/AppShell";
import { Footer } from "@/components/icms/Footer";
import { PriorityChip, StatusChip } from "@/components/icms/StatusChip";
import { RegisterPagination } from "@/components/icms/RegisterPagination";
import { paginationLabelsEn } from "@/components/icms/pagination-labels.en";
import { PRIORITY_VALUES, STATUS_META, STATUS_VALUES, type PriorityValue, type StatusValue } from "@/components/icms/status";
import { PRIORITY_LABELS_EN, STATUS_LABELS_EN } from "@/components/icms/status-labels.en";
import { EmptyState, ErrorState, InlineSpinner, LoadingState, NoResultsState, TableLoadingRows } from "@/components/icms/states";
import { Icon, ICON_KEYS, resolveIconId, useIconSet, type IconKey } from "@/lib/icons";

import { Row, Section, Swatch, TokenTable } from "./kit";

const EARTH = ["0", "50", "100", "200", "300", "400", "500", "600", "700", "800", "850", "900", "950"];
const RAMP = ["300", "400", "500", "600", "700", "800"];
const SEMANTIC = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground", "border", "input", "ring"];
const SURFACES = ["surface-canvas", "surface-1", "surface-2", "surface-3", "surface-sunken", "surface-overlay"];
const TEXTS = ["text-strong", "text-base-c", "text-muted", "text-faint", "text-link", "text-on-accent"];
const LINES = ["border-subtle", "border-base", "border-strong", "border-accent-c"];
const TONES = ["neutral", "accent", "info", "success", "warning", "danger"] as const;

const TYPE_STEPS = [
  ["text-4xl", "44px / KPI value"],
  ["text-3xl", "36px / page H1"],
  ["text-2xl", "30px"],
  ["text-xl", "24px / section heading"],
  ["text-lg", "20px / card title"],
  ["text-md", "16px"],
  ["text-base", "14px / body"],
  ["text-sm", "13px / table body"],
  ["text-xs", "11px / column header"],
  ["text-2xs", "10px / dense meta"],
] as const;

const SAMPLE_ROWS: ReadonlyArray<
  [string, string, string, PriorityValue, StatusValue]
> = [
  ["CMP-2026-0412", "RJ-JPR-1007", "482 sq.m", "high", "pendingInspection"],
  ["CMP-2026-0395", "RJ-JPR-1002", "1,240 sq.m", "medium", "noticeIssued"],
  ["CMP-2026-0318", "RJ-JPR-0991", "318 sq.m", "low", "closed"],
];

const chartData = [
  { zone: "North", count: 86 },
  { zone: "South", count: 62 },
  { zone: "East", count: 104 },
  { zone: "West", count: 48 },
  { zone: "Central", count: 131 },
];
const chartConfig = {
  count: { label: "Encroachments", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Every token and every component, rendered once.
 *
 * The page renders this twice in split mode — one subtree under
 * [data-theme="dark"], one under [data-theme="light"] — which is the proof
 * that nothing here carries a baked-in value.
 */
export function Gallery() {
  const activeSet = useIconSet();
  const [page, setPage] = useState(3);
  const [pageSize, setPageSize] = useState(10);
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 8, 7));
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(2026, 8, 6),
    to: new Date(2026, 8, 12),
  });
  const [slider, setSlider] = useState([100]);
  const form = useForm<{ parcelId: string }>({ defaultValues: { parcelId: "" } });

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-10 bg-surface-canvas p-5 text-foreground">
        {/* ============================== COLOUR ============================= */}
        <Section
          id="colour"
          title="Colour"
          note="Five values exist in Figma. Everything else is derived; each swatch shows its live computed value in this theme."
        >
          <Row
            label="Neutral — earth ramp"
            hint="850/800 are brown 2 / dark brown; 500 and 0 are the Earthy stops. The rest is OKLab-interpolated at H=66.68."
          >
            {EARTH.map((s) => (
              <Swatch
                key={s}
                name={`--earth-${s}`}
                note={["0", "500", "800", "850"].includes(s) ? "FIGMA" : "derived"}
              />
            ))}
          </Row>

          <Row
            label="Ochre accent"
            hint="500 is `color 1` verbatim; the rest are ±0.065 OKLCH lightness steps."
          >
            {RAMP.map((s) => (
              <Swatch key={s} name={`--ochre-${s}`} note={s === "500" ? "FIGMA" : "derived"} />
            ))}
          </Row>

          {(["danger", "warning", "success", "info"] as const).map((fam) => (
            <Row
              key={fam}
              label={`Semantic — ${fam}`}
              hint="Absent from Figma entirely. Base lifted from the screen pixels, then regularised onto one lightness grid."
            >
              {RAMP.map((s) => (
                <Swatch key={s} name={`--${fam}-${s}`} note="derived" />
              ))}
            </Row>
          ))}

          <Row label="shadcn semantic contract" hint="What every primitive inherits.">
            {SEMANTIC.map((n) => (
              <Swatch key={n} name={`--${n}`} wide />
            ))}
          </Row>

          <Row
            label="Surface levels"
            hint="shadcn names no canvas or sunken level; the registers need five depths."
          >
            {SURFACES.map((n) => (
              <Swatch key={n} name={`--${n}`} wide />
            ))}
          </Row>

          <Row label="Text levels">
            {TEXTS.map((n) => (
              <Swatch key={n} name={`--${n}`} wide />
            ))}
          </Row>

          <Row label="Border levels">
            {LINES.map((n) => (
              <Swatch key={n} name={`--${n}`} wide />
            ))}
          </Row>

          <Row
            label="Chart series"
            hint="Five hues at constant OKLCH L=0.70 C=0.13, so no series dominates by luminance."
          >
            {["1", "2", "3", "4", "5"].map((n) => (
              <Swatch key={n} name={`--chart-${n}`} />
            ))}
          </Row>
        </Section>

        {/* ============================ TYPOGRAPHY =========================== */}
        <Section
          id="type"
          title="Typography"
          note="No font, size, weight or line-height variable exists in Figma. Families identified from the renders; the scale is ~1.2 anchored at 14px body."
        >
          <Row label="Families">
            <div className="flex w-full flex-col gap-2">
              <p className="font-display text-xl font-bold">
                Display — Encroachment Monitoring Overview
              </p>
              <p className="font-sans text-base">
                Body — Track &amp; manage all complaints &middot; भूमिका चुनें / उपयोगकर्ता नाम
              </p>
              <p className="font-mono text-sm">
                Mono — 28.6139&deg;N, 77.2090&deg;E &middot; 482 sq.m &middot; RJ-JPR-1007
              </p>
            </div>
          </Row>

          <Row label="Size scale">
            <div className="flex w-full flex-col gap-2">
              {TYPE_STEPS.map(([cls, note]) => (
                <div key={cls} className="flex flex-wrap items-baseline gap-3">
                  <span className={`${cls} font-display font-semibold text-fg-strong`}>
                    Complaints Register
                  </span>
                  <code className="font-mono text-2xs text-fg-faint">
                    {cls} &middot; {note}
                  </code>
                </div>
              ))}
            </div>
          </Row>

          <Row label="Weights and tracking">
            <div className="flex w-full flex-col gap-1 text-base">
              <span className="font-normal">400 regular</span>
              <span className="font-medium">500 medium</span>
              <span className="font-semibold">600 semibold</span>
              <span className="font-bold">700 bold</span>
              <span className="mt-2 text-xs font-semibold tracking-wider text-fg-muted uppercase">
                tracking-wider &middot; column header treatment
              </span>
            </div>
          </Row>
        </Section>

        {/* ==================== SPACING / RADII / ELEVATION ================== */}
        <Section
          id="scale"
          title="Spacing, radii, borders, elevation, z-index, motion"
          note="All derived. Spacing is a 4px base because the measured gutters land on 8/12/16/24/32."
        >
          <Row label="Spacing">
            <div className="flex w-full flex-col gap-1">
              {["1", "2", "3", "4", "6", "8", "12", "16", "24"].map((s) => (
                <div key={s} className="flex items-center gap-3">
                  <div
                    className="h-3 bg-accent-solid"
                    style={{ width: `calc(var(--spacing) * ${s})` }}
                  />
                  <code className="font-mono text-2xs text-fg-faint">
                    {s} &middot; {Number(s) * 4}px
                  </code>
                </div>
              ))}
            </div>
          </Row>

          <Row label="Radii">
            <div className="flex flex-wrap gap-3">
              <div className="flex w-24 flex-col items-center gap-1">
                <div className="size-16 rounded-xs border border-line bg-surface-2" />
                <code className="font-mono text-2xs text-fg-faint">rounded-xs</code>
              </div>
              <div className="flex w-24 flex-col items-center gap-1">
                <div className="size-16 rounded-sm border border-line bg-surface-2" />
                <code className="font-mono text-2xs text-fg-faint">rounded-sm</code>
              </div>
              <div className="flex w-24 flex-col items-center gap-1">
                <div className="size-16 rounded-md border border-line bg-surface-2" />
                <code className="font-mono text-2xs text-fg-faint">rounded-md</code>
              </div>
              <div className="flex w-24 flex-col items-center gap-1">
                <div className="size-16 rounded-lg border border-line bg-surface-2" />
                <code className="font-mono text-2xs text-fg-faint">rounded-lg</code>
              </div>
              <div className="flex w-24 flex-col items-center gap-1">
                <div className="size-16 rounded-xl border border-line bg-surface-2" />
                <code className="font-mono text-2xs text-fg-faint">rounded-xl</code>
              </div>
              <div className="flex w-24 flex-col items-center gap-1">
                <div className="size-16 rounded-2xl border border-line bg-surface-2" />
                <code className="font-mono text-2xs text-fg-faint">rounded-2xl</code>
              </div>
              <div className="flex w-24 flex-col items-center gap-1">
                <div className="size-16 rounded-full border border-line bg-surface-2" />
                <code className="font-mono text-2xs text-fg-faint">rounded-full</code>
              </div>
            </div>
          </Row>

          <Row
            label="Border widths"
            hint="Hairline everywhere; 2px is the focus ring; 3px is the KPI tile's leading ochre bar."
          >
            <div className="flex flex-wrap gap-4">
              <div className="h-16 w-28 border border-line bg-surface-2" />
              <div className="h-16 w-28 border-2 border-ring bg-surface-2" />
              <div className="h-16 w-28 border-l-[3px] border-l-line-accent bg-surface-2" />
            </div>
          </Row>

          <Row label="Elevation">
            <div className="flex size-24 items-center justify-center rounded-lg bg-surface-1 shadow-xs">
              <code className="font-mono text-2xs text-fg-faint">xs</code>
            </div>
            <div className="flex size-24 items-center justify-center rounded-lg bg-surface-1 shadow-sm">
              <code className="font-mono text-2xs text-fg-faint">sm</code>
            </div>
            <div className="flex size-24 items-center justify-center rounded-lg bg-surface-1 shadow-md">
              <code className="font-mono text-2xs text-fg-faint">md</code>
            </div>
            <div className="flex size-24 items-center justify-center rounded-lg bg-surface-1 shadow-lg">
              <code className="font-mono text-2xs text-fg-faint">lg</code>
            </div>
            <div className="flex size-24 items-center justify-center rounded-lg bg-surface-1 shadow-xl">
              <code className="font-mono text-2xs text-fg-faint">xl</code>
            </div>
          </Row>

          <Row
            label="Z-index layers"
            hint="Radix portals mount at the end of body; these order app chrome, and give the map an explicit floor of 0."
          >
            <TokenTable
              rows={[
                { token: "--z-map", note: "Map canvas floor — keeps MapLibre under every panel" },
                { token: "--z-sticky", note: "Sticky table headers" },
                { token: "--z-header", note: "Top bar" },
                { token: "--z-sidebar", note: "Rail, above the header's shadow" },
                { token: "--z-dropdown", note: "Menus" },
                { token: "--z-overlay", note: "Dialog / sheet scrim" },
                { token: "--z-modal", note: "Dialog surface" },
                { token: "--z-popover", note: "Popover opened from inside a modal" },
                { token: "--z-toast", note: "Above modals — an error must be readable over one" },
                { token: "--z-tooltip", note: "Always topmost" },
              ]}
            />
          </Row>

          <Row
            label="Motion"
            hint="Distance-travelled rule: the further a surface moves, the longer it takes."
          >
            <TokenTable
              rows={[
                { token: "--duration-fast", note: "Colour/opacity only: hover, chip, icon" },
                { token: "--duration-base", note: "Small transforms: dropdown, tooltip, popover" },
                { token: "--duration-slow", note: "Dialog, accordion, tab panel" },
                { token: "--duration-slower", note: "Sheet and drawer — full-height travel" },
                { token: "--ease-standard", note: "Default curve" },
                { token: "--ease-decelerate", note: "Entering" },
                { token: "--ease-accelerate", note: "Leaving" },
              ]}
            />
          </Row>
        </Section>

        {/* =============================== ICONS ============================ */}
        <Section
          id="icons"
          title={`Icons — ${ICON_KEYS.length} semantic keys, active set "${activeSet}"`}
          note="Screens name an intent, never a glyph. Switch the set in the toolbar above and every icon here changes at once — that is the whole mechanism."
        >
          <Row label="Registry" hint="Key, glyph, and the concrete set:name it resolves to right now.">
            <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
              {ICON_KEYS.map((key: IconKey) => (
                <div
                  key={key}
                  className="flex min-w-0 items-center gap-2 rounded-md border border-line-subtle bg-surface-2 px-2 py-1.5"
                >
                  <Icon name={key} className="size-5 shrink-0 text-fg-base" />
                  <div className="flex min-w-0 flex-col">
                    <code className="truncate font-mono text-2xs text-fg-base">{key}</code>
                    <code className="truncate font-mono text-2xs text-fg-faint">
                      {resolveIconId(key, activeSet)}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </Row>

          <Row
            label="Local SVG drop-in"
            hint="map.parcel is a hand-authored SVG, not an Iconify icon. It ignores the set switcher — which is the point: a downloaded Flaticon glyph behaves the same way."
          >
            <div className="flex items-center gap-3">
              <Icon name="map.parcel" className="size-10 text-accent-solid" />
              <code className="font-mono text-2xs text-fg-faint">
                {resolveIconId("map.parcel", activeSet)}
              </code>
            </div>
          </Row>
        </Section>

        {/* =========================== STATUS CHIPS ========================= */}
        <Section
          id="status"
          title="Status chips"
          note="Ten distinct Figma labels plus an `unknown` API fallback. Six tones across eleven values, so the icon — not the hue — distinguishes Closed from Completed from Responded."
        >
          <Row label="All statuses">
            {STATUS_VALUES.map((s) => (
              <StatusChip key={s} status={s} uppercase>
                {STATUS_LABELS_EN[s]}
              </StatusChip>
            ))}
          </Row>

          <Row label="Sizes">
            {(["sm", "md", "lg"] as const).map((size) => (
              <StatusChip key={size} status="overdue" size={size}>
                {STATUS_LABELS_EN.overdue}
              </StatusChip>
            ))}
          </Row>

          <Row
            label="Priority"
            hint="Figma renders these as bare coloured text — colour-only, which fails WCAG 1.4.1. Same chip treatment."
          >
            {PRIORITY_VALUES.map((p) => (
              <PriorityChip key={p} priority={p}>
                {PRIORITY_LABELS_EN[p]}
              </PriorityChip>
            ))}
          </Row>

          <Row label="Tone tokens">
            {TONES.map((t) => (
              <div key={t} className="flex w-36 flex-col gap-1">
                <div
                  className="flex h-10 items-center justify-center rounded-md border text-xs font-medium"
                  style={{
                    background: `var(--status-${t}-bg)`,
                    color: `var(--status-${t}-fg)`,
                    borderColor: `var(--status-${t}-border)`,
                  }}
                >
                  {t}
                </div>
                <code className="font-mono text-2xs text-fg-faint">--status-{t}-*</code>
              </div>
            ))}
          </Row>

          <Row label="Register mapping">
            <TokenTable
              rows={STATUS_VALUES.map((s) => ({
                token: s,
                value: STATUS_META[s].tone,
                note:
                  STATUS_META[s].registers.length > 0
                    ? `${STATUS_META[s].registers.join(", ")} — ${STATUS_META[s].icon}`
                    : `not in Figma; API fallback — ${STATUS_META[s].icon}`,
              }))}
            />
          </Row>
        </Section>

        {/* ========================= AUTHORED PATTERNS ====================== */}
        <Section
          id="patterns"
          title="Authored components"
          note="Not in the shadcn registry and not designed in Figma. Built here because every register needs them."
        >
          <Row
            label="RegisterPagination"
            hint="Figma shows a static `Showing 8 records` and a bare `1 2 3`. This is the working control."
            className="w-full"
          >
            <div className="w-full rounded-lg border border-line-subtle bg-surface-1">
              <RegisterPagination
                page={page}
                pageSize={pageSize}
                total={248}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                labels={paginationLabelsEn}
              />
            </div>
          </Row>

          <Row label="Grid states" className="w-full">
            <div className="grid w-full gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-line-subtle bg-surface-1">
                <EmptyState
                  size="compact"
                  title="No complaints yet"
                  description="Filed complaints appear here once the first one is registered."
                  action={
                    <Button size="sm">
                      <Icon name="action.add" className="size-4" />
                      New Complaint
                    </Button>
                  }
                />
              </div>
              <div className="rounded-lg border border-line-subtle bg-surface-1">
                <NoResultsState
                  size="compact"
                  title="No matching records"
                  description="No complaint matches these filters."
                  action={
                    <Button size="sm" variant="outline">
                      <Icon name="action.clear" className="size-4" />
                      Clear filters
                    </Button>
                  }
                />
              </div>
              <div className="rounded-lg border border-line-subtle bg-surface-1">
                <ErrorState
                  size="compact"
                  title="Could not load complaints"
                  description="The register service did not respond."
                  detail="HTTP 503 · trace 4f1c-9ab2"
                  retryLabel="Retry"
                  onRetry={() => toast.info("Retry requested")}
                />
              </div>
            </div>
          </Row>

          <Row label="Loading states" className="w-full">
            <div className="grid w-full gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-line-subtle bg-surface-1">
                <LoadingState label="Loading complaints" />
              </div>
              <div className="overflow-hidden rounded-lg border border-line-subtle bg-surface-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Complaint ID</TableHead>
                      <TableHead>Parcel ID</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableLoadingRows rows={4} columns={4} />
                  </TableBody>
                </Table>
              </div>
            </div>
            <InlineSpinner label="Running change detection" />
          </Row>

          <Row
            label="AppShell"
            hint="Header + rail + content + footer, responsive to 360px. Shown inside a fixed frame."
            className="w-full"
          >
            <div className="h-[28rem] w-full overflow-hidden rounded-lg border border-line-subtle">
              <AppShell
                labels={{
                  openNavigation: "Open navigation",
                  closeNavigation: "Close navigation",
                  collapseNavigation: "Collapse navigation",
                  expandNavigation: "Expand navigation",
                  navigationLandmark: "Primary",
                  skipToContent: "Skip to content",
                }}
                brand={
                  <div className="flex items-center gap-2">
                    <Icon name="map.encroachment" className="size-6 text-accent-solid" />
                    <span className="font-display text-md font-bold">ICMS</span>
                  </div>
                }
                nav={
                  <div className="flex flex-col gap-0.5">
                    <AppShellNavItem icon="nav.dashboard" label="Dashboard" active />
                    <AppShellNavItem icon="nav.changeDetection" label="Change Detection" />
                    <AppShellNavItem icon="nav.complaints" label="Complaints" badge={8} />
                    <AppShellNavItem icon="nav.inspection" label="Inspection" />
                    <AppShellNavItem icon="nav.notice" label="Notice" />
                    <AppShellNavItem icon="nav.report" label="Report" />
                  </div>
                }
                navFooter={
                  <div className="flex items-center gap-2">
                    <Avatar className="size-8">
                      <AvatarFallback>JD</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm">John Doe</p>
                      <p className="truncate text-2xs text-status-success-fg">Online</p>
                    </div>
                  </div>
                }
                header={
                  <>
                    <h2 className="min-w-0 flex-1 truncate font-display text-md font-bold">
                      Complaints
                    </h2>
                    <Button variant="ghost" size="icon-sm" aria-label="Notifications">
                      <Icon name="nav.notifications" className="size-4" />
                    </Button>
                  </>
                }
                footer={
                  <Footer
                    copyright="© 2026 Agra Development Authority"
                    version="icms 0.1.0 · build dev"
                    support="Support 1800-123-4567"
                    links={[
                      { id: "sec", label: "Security Policy", href: "#" },
                      { id: "gis", label: "GIS Portal", href: "#" },
                      { id: "tos", label: "Terms of Service", href: "#" },
                    ]}
                  />
                }
              >
                <p className="text-sm text-fg-muted">
                  Page content. Narrow the window: below <code>lg</code> the rail moves
                  into a sheet behind the menu button.
                </p>
              </AppShell>
            </div>
          </Row>

          <Row label="Footer, standalone" className="w-full">
            <div className="w-full">
              <Footer
                copyright="© 2026 Agra Development Authority"
                version="icms 0.1.0"
                links={[
                  { id: "sec", label: "Security Policy", href: "#" },
                  { id: "gis", label: "GIS Portal", href: "#", external: true },
                ]}
                attribution="Icons: Lucide (ISC), Tabler (MIT), Material Symbols (Apache-2.0). No attribution required."
              />
            </div>
          </Row>
        </Section>

        {/* ========================= SHADCN PRIMITIVES ====================== */}
        <Section
          id="primitives"
          title="shadcn primitives"
          note="Every installed component. If any of these render slate-grey, a token mapping is wrong."
        >
          <Row label="Button">
            {(["default", "secondary", "outline", "ghost", "link", "destructive"] as const).map(
              (v) => (
                <Button key={v} variant={v}>
                  {v}
                </Button>
              ),
            )}
            <Button size="sm">sm</Button>
            <Button size="lg">lg</Button>
            <Button size="icon" aria-label="Add">
              <Icon name="action.add" className="size-4" />
            </Button>
            <Button disabled>disabled</Button>
            <Button>
              <Icon name="action.export" className="size-4" />
              Export
            </Button>
          </Row>

          <Row label="Badge">
            {(["default", "secondary", "outline", "destructive", "ghost"] as const).map((v) => (
              <Badge key={v} variant={v}>
                {v}
              </Badge>
            ))}
          </Row>

          <Row label="Input, Label, Textarea">
            <div className="flex w-full max-w-md flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ds-parcel">Parcel ID</Label>
                <Input id="ds-parcel" placeholder="RJ-JPR-1007" />
              </div>
              <Input placeholder="Disabled" disabled />
              <Input placeholder="Invalid" aria-invalid />
              <Textarea placeholder="Describe the nature of encroachment…" rows={3} />
            </div>
          </Row>

          <Row label="Select, Checkbox, Radio, Switch, Slider">
            <div className="flex w-full max-w-md flex-col gap-4">
              <Select defaultValue="high">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Checkbox id="ds-remember" defaultChecked />
                <Label htmlFor="ds-remember">Remember me</Label>
              </div>
              <RadioGroup defaultValue="structure" className="flex gap-4">
                {["structure", "agricultural"].map((v) => (
                  <div key={v} className="flex items-center gap-2">
                    <RadioGroupItem value={v} id={`ds-${v}`} />
                    <Label htmlFor={`ds-${v}`}>{v}</Label>
                  </div>
                ))}
              </RadioGroup>
              <div className="flex items-center gap-2">
                <Switch id="ds-overlay" defaultChecked />
                <Label htmlFor="ds-overlay">Overlay</Label>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Overlay opacity — {slider[0]}%</Label>
                <Slider value={slider} onValueChange={setSlider} max={100} step={1} />
              </div>
            </div>
          </Row>

          <Row label="Form (react-hook-form; zod + @hookform/resolvers installed)">
            <Form {...form}>
              <form
                className="flex w-full max-w-md flex-col gap-3"
                onSubmit={form.handleSubmit(() => toast.success("Submitted"))}
              >
                <FormField
                  control={form.control}
                  name="parcelId"
                  rules={{ required: "Parcel ID is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parcel ID</FormLabel>
                      <FormControl>
                        <Input placeholder="RJ-JPR-1007" {...field} />
                      </FormControl>
                      <FormDescription>
                        Updated automatically from the map selection.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" size="sm" className="self-start">
                  Submit
                </Button>
              </form>
            </Form>
          </Row>

          <Row label="Date picker — authored wiring (Popover + Calendar + Button)">
            <div className="flex w-full max-w-md flex-col gap-3">
              <DatePicker
                value={date}
                onChange={setDate}
                placeholder="Select a date"
                format={(d) =>
                  d.toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                }
              />
              <DateRangePicker
                value={range}
                onChange={setRange}
                placeholder="Select a range"
                numberOfMonths={1}
                format={(r) =>
                  `${r.from?.toLocaleDateString("en-IN") ?? ""} – ${
                    r.to?.toLocaleDateString("en-IN") ?? ""
                  }`
                }
              />
            </div>
          </Row>

          <Row label="Calendar">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              className="rounded-lg border border-line-subtle"
            />
          </Row>

          <Row label="Table" className="w-full">
            <div className="w-full overflow-x-auto">
              <Table>
                <TableCaption>Complaints Register — 3 of 248 records</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Complaint ID</TableHead>
                    <TableHead>Parcel ID</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SAMPLE_ROWS.map(([id, parcel, area, prio, status]) => (
                    <TableRow key={id}>
                      <TableCell className="font-mono text-fg-link">{id}</TableCell>
                      <TableCell className="font-mono">{parcel}</TableCell>
                      <TableCell className="tabular">{area}</TableCell>
                      <TableCell>
                        <PriorityChip priority={prio}>
                          {PRIORITY_LABELS_EN[prio]}
                        </PriorityChip>
                      </TableCell>
                      <TableCell>
                        <StatusChip status={status} size="sm" uppercase>
                          {STATUS_LABELS_EN[status]}
                        </StatusChip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Row>

          <Row label="Card">
            <Card className="w-full max-w-sm">
              <CardHeader>
                <CardTitle>Detection Details</CardTitle>
                <CardDescription>DET-2026-1042 · Bassi, Jaipur</CardDescription>
                <CardAction>
                  <StatusChip status="complaintFiled" size="sm">
                    Newly Detected
                  </StatusChip>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-fg-muted">Affected Area</span>
                  <span className="font-mono tabular">434 sq.m</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-fg-muted">Detection Confidence</span>
                  <Progress value={84} />
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button size="sm" variant="outline">
                  View Full Details
                </Button>
                <Button size="sm">Create Complaint</Button>
              </CardFooter>
            </Card>
          </Row>

          <Row label="Alert">
            <div className="flex w-full flex-col gap-3">
              <Alert>
                <Icon name="feedback.info" className="size-4" />
                <AlertTitle>Dev note carried over from the design file</AlertTitle>
                <AlertDescription>
                  Parcel ID and Village update from the map selection; both remain
                  editable by hand.
                </AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <Icon name="feedback.error" className="size-4" />
                <AlertTitle>Notice overdue</AlertTitle>
                <AlertDescription>
                  NTC-2026-0142 passed its compliance due date on 15 Sep 2026.
                </AlertDescription>
              </Alert>
            </div>
          </Row>

          <Row label="Overlays — Dialog, AlertDialog, Sheet, Drawer, Popover, HoverCard, Tooltip">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Dialog
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign Inspection — RJ-JPR-1007</DialogTitle>
                  <DialogDescription>
                    Select an inspector and a schedule window.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Close</Button>
                  </DialogClose>
                  <Button>Assign Inspection</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  AlertDialog
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Close this complaint?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Closing removes it from the active register. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Close complaint</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  Sheet
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Layer controls</SheetTitle>
                  <SheetDescription>Toggle the map overlays.</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>

            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="outline" size="sm">
                  Drawer
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Detected changes</DrawerTitle>
                  <DrawerDescription>4 detections in this extent.</DrawerDescription>
                </DrawerHeader>
                <DrawerFooter>
                  <DrawerClose asChild>
                    <Button variant="outline">Close</Button>
                  </DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  Popover
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <p className="font-mono text-sm">28.6139°N, 77.2090°E</p>
              </PopoverContent>
            </Popover>

            <HoverCard>
              <HoverCardTrigger asChild>
                <Button variant="link" size="sm">
                  HoverCard
                </Button>
              </HoverCardTrigger>
              <HoverCardContent>
                <p className="text-sm">Survey No. 142/B, Sector 7 — 482 sq.m</p>
              </HoverCardContent>
            </HoverCard>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Print notice">
                  <Icon name="notice.print" className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Print notice</TooltipContent>
            </Tooltip>
          </Row>

          <Row label="Menus — Dropdown, Context, Menubar, NavigationMenu, Command">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Dropdown
                  <Icon name="form.chevronDown" className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Icon name="action.view" className="size-4" />
                  View
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Icon name="case.assign" className="size-4" />
                  Assign Inspection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ContextMenu>
              <ContextMenuTrigger className="flex h-9 items-center rounded-md border border-dashed border-line px-3 text-sm text-fg-muted">
                Right-click me
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>Export row</ContextMenuItem>
                <ContextMenuItem>Copy Parcel ID</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            <Menubar>
              <MenubarMenu>
                <MenubarTrigger>File</MenubarTrigger>
                <MenubarContent>
                  <MenubarItem>Export CSV</MenubarItem>
                  <MenubarItem>Print</MenubarItem>
                </MenubarContent>
              </MenubarMenu>
              <MenubarMenu>
                <MenubarTrigger>View</MenubarTrigger>
                <MenubarContent>
                  <MenubarItem>Overlay</MenubarItem>
                </MenubarContent>
              </MenubarMenu>
            </Menubar>

            <NavigationMenu>
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger>Registers</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-56 gap-1 p-2">
                      <NavigationMenuLink href="#">Complaints</NavigationMenuLink>
                      <NavigationMenuLink href="#">Inspection</NavigationMenuLink>
                      <NavigationMenuLink href="#">Notices</NavigationMenuLink>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>

            <Command className="w-full max-w-sm rounded-lg border border-line-subtle">
              <CommandInput placeholder="Search parcel / Khasra No." />
              <CommandList>
                <CommandEmpty>No results.</CommandEmpty>
                <CommandGroup heading="Parcels">
                  <CommandItem>RJ-JPR-1007</CommandItem>
                  <CommandItem>RJ-JPR-1002</CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </Row>

          <Row label="Tabs, Accordion, Collapsible">
            <div className="flex w-full max-w-lg flex-col gap-4">
              <Tabs defaultValue="list">
                <TabsList>
                  <TabsTrigger value="list">Inspection List</TabsTrigger>
                  <TabsTrigger value="findings">Record Findings</TabsTrigger>
                </TabsList>
                <TabsContent value="list" className="text-sm text-fg-muted">
                  Both tabs exist in Figma; the second is hidden in the layer tree.
                </TabsContent>
                <TabsContent value="findings" className="text-sm text-fg-muted">
                  Site findings form.
                </TabsContent>
              </Tabs>

              <Accordion type="single" collapsible>
                <AccordionItem value="a">
                  <AccordionTrigger>Notice template</AccordionTrigger>
                  <AccordionContent>
                    Official DLA letterhead · Unique notice ID (NTC-YYYY-XXXX) · Legal
                    section references · Map extract · Signature block.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Icon name="form.chevronDown" className="size-4" />
                    Advanced filters
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 text-sm text-fg-muted">
                  Village, tehsil, detection confidence.
                </CollapsibleContent>
              </Collapsible>
            </div>
          </Row>

          <Row label="Breadcrumb, Separator, Avatar, Progress, Skeleton, AspectRatio">
            <div className="flex w-full flex-col gap-4">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="#">Dashboard</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink href="#">Complaints</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>CMP-2026-0412</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <Separator />
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
                <Progress value={62} className="max-w-xs" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="w-56">
                <AspectRatio ratio={16 / 9}>
                  <div className="flex size-full items-center justify-center rounded-md bg-surface-2 text-xs text-fg-faint">
                    16 / 9
                  </div>
                </AspectRatio>
              </div>
            </div>
          </Row>

          <Row label="Toggle, ToggleGroup, ScrollArea, Resizable, InputOTP, Carousel, Sonner">
            <div className="flex w-full flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Toggle aria-label="Overlay">
                  <Icon name="map.overlay" className="size-4" />
                </Toggle>
                <ToggleGroup type="single" defaultValue="pan">
                  <ToggleGroupItem value="pan" aria-label="Pan">
                    <Icon name="map.pan" className="size-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="zoom" aria-label="Zoom in">
                    <Icon name="map.zoomIn" className="size-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="measure" aria-label="Measure">
                    <Icon name="inspection.measure" className="size-4" />
                  </ToggleGroupItem>
                </ToggleGroup>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    toast.success("Notice issued", { description: "NTC-2026-0143" })
                  }
                >
                  Toast
                </Button>
              </div>

              <ScrollArea className="h-28 w-full max-w-sm rounded-md border border-line-subtle p-3">
                <div className="flex flex-col gap-1 text-sm">
                  {Array.from({ length: 12 }, (_, i) => (
                    <span key={i} className="font-mono">
                      ENC-2024-{String(860 + i).padStart(4, "0")}
                    </span>
                  ))}
                </div>
              </ScrollArea>

              {/* react-resizable-panels v4 renamed `direction` to `orientation`. */}
              <ResizablePanelGroup
                orientation="horizontal"
                className="h-32 max-w-lg rounded-lg border border-line-subtle"
              >
                <ResizablePanel defaultSize="60">
                  <div className="flex h-full items-center justify-center text-sm text-fg-muted">
                    Map
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="40">
                  <div className="flex h-full items-center justify-center text-sm text-fg-muted">
                    Detections
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>

              <InputOTP maxLength={6}>
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>

              <Carousel className="w-full max-w-sm">
                <CarouselContent>
                  {["Evidence 1", "Evidence 2", "Evidence 3"].map((t) => (
                    <CarouselItem key={t}>
                      <div className="flex h-28 items-center justify-center rounded-md border border-line-subtle bg-surface-2 text-sm text-fg-muted">
                        {t}
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </div>
          </Row>

          <Row label="Chart" className="w-full">
            <ChartContainer config={chartConfig} className="h-56 w-full max-w-xl">
              <BarChart data={chartData}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="zone" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={4} />
              </BarChart>
            </ChartContainer>
          </Row>
        </Section>
      </div>
    </TooltipProvider>
  );
}
