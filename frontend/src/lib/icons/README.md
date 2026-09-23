# ICMS icon system

Screens never name an icon. They name an **intent**:

```tsx
import { Icon } from "@/lib/icons";

<Icon name="case.assign" className="size-4" />
<Icon name="status.overdue" className="size-3.5" label={t("status.overdue")} />
```

`name` is typed against the key union, so a typo or a removed key is a compile
error rather than a blank square.

## The pieces

| File | Role |
| --- | --- |
| `icon-map.ts` | **The switch.** Semantic key -> bare icon name + per-set overrides. No React, so the build script can import it under Node type stripping. |
| `icon-data.generated.ts` | Generated. Resolved icon data for every key x every bundled set. Do not edit. |
| `registry.tsx` | `<Icon>`, `IconSetProvider`, `LOCAL_ICONS`, resolution and fallback. |
| `types.ts` | The prop contract a drop-in local SVG must satisfy. |
| `../../assets/icons/` | Drop-in SVGs (Flaticon downloads, in-house marks). |
| `../../../scripts/build-icon-data.mjs` | Rebuilds the bundle, reports gaps. `npm run icons:build`. |

## Why Iconify and not an icon package

`@iconify/react` addresses icons as `"set:name"` strings, so changing the set is
a string change rather than a rewrite. 200k+ icons across 150+ sets are
available under one API.

Icons are **bundled offline**, not fetched. `@iconify/react` will otherwise call
`api.iconify.design` for an unknown icon at render time; this portal may run
air-gapped, so `build-icon-data.mjs` extracts a subset (only the icons
`icon-map.ts` names) into resolved data objects, and `<Icon>` hands `@iconify/react`
an **object**, never a string. There is no code path to the network.

Current bundle: **132 keys x 3 sets = 352 unique icons, ~107 kB** before gzip
and before tree-shaking. The whole of Lucide + Tabler + Material Symbols would
be ~24,000 icons.

`lucide-react` is still a dependency: shadcn's generated primitives import it
directly for their own internal chevrons and check marks. App-level code should
not import it — use `<Icon>`. Since the default Iconify set is also Lucide, the
two are visually identical, so leaving the primitives alone costs nothing.

## Swapping the icon set

**Whole app, permanently** — one line in `icon-map.ts`:

```ts
export const DEFAULT_ICON_SET: IconSetId = "tabler";   // was "lucide"
```

Then `npm run icons:build`. Every icon in the app changes.

**A subtree, at runtime** — wrap it:

```tsx
<IconSetProvider set="material-symbols">{children}</IconSetProvider>
```

**One icon** — edit its entry:

```ts
"nav.report": { name: "chart-line", per: { tabler: "chart-line", "material-symbols": "monitoring" } },
```

**Adding a new set** — `npm i -D @iconify-json/<set>`, add it to `ICON_SETS` in
`icon-map.ts`, run `npm run icons:build`. The script lists every key with no
equivalent in the new set; each of those falls back to the default set, so the
app never renders a missing glyph. Fill the gaps in with `per` overrides.

## Adding a downloaded SVG (Flaticon or anywhere)

Flaticon requires an account and downloads one icon at a time, so this is a
manual, four-step process. There is no automated fetch and there should not be.

1. Download the icon as **SVG** and put it in `src/assets/icons/`.
2. Wrap it as a component matching the contract in `types.ts` — copy
   `KhasraParcelIcon.tsx`. Non-negotiable: `viewBox="0 0 24 24"`,
   `width="1em" height="1em"`, `stroke="currentColor"` or `fill="currentColor"`,
   **no hex anywhere** (a raw hex in a `.tsx` is a defect), and spread
   `className` + props so `size-4` and `aria-hidden` still work.
3. Register it in `registry.tsx`:

   ```ts
   export const LOCAL_ICONS: Partial<Record<IconKey, ComponentType<LocalIconProps>>> = {
     "map.parcel": KhasraParcelIcon,
     "notice.seal": MyFlaticonSeal,   // <- new
   };
   ```

   For a genuinely new intent, add the key to `ICON_MAP` first with the closest
   Iconify name as the fallback, then override it here.
4. Nothing else. Every existing `<Icon name="notice.seal" />` now renders the
   new SVG. A local icon wins over every set, so `IconSetProvider` will not
   override it.

## Licensing

| Source | Sets | Licence | Attribution required |
| --- | --- | --- | --- |
| Iconify (bundled) | `lucide` | ISC | No |
| Iconify (bundled) | `tabler` | MIT | No |
| Iconify (bundled) | `material-symbols` | Apache-2.0 | No |
| `lucide-react` (shadcn primitives only) | Lucide | ISC | No |
| `src/assets/icons/KhasraParcelIcon.tsx` | in-house | project-owned | No |
| Flaticon **free tier** | per icon | Flaticon Free Licence | **Yes — visible attribution per icon** |
| Flaticon **premium** | per icon | Flaticon Premium | No, subscription required |

Much of the Flaticon catalogue is premium. Free-tier icons carry a
per-icon attribution obligation that must appear in the UI (commonly the
footer). Nothing bundled today triggers it. If a Flaticon free-tier icon is
added, record the author and URL in a comment on its component and add the
credit line to `Footer.tsx`.

## Existing icon inventory and migration mapping

### Raster icons: there are none

A full sweep of `frontend/public/` and `frontend/src/` for `.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.ico` `.svg` returns **exactly one file**:

| File | What it is | Action |
| --- | --- | --- |
| `public/logo-mcpl.svg` | PCSMCPL brand mark, referenced from `index.html` as the favicon | **Keep.** A logo is not an icon; it does not belong in the semantic registry and must not change when the icon set is swapped. |

So the "replace the .png" part of the request has nothing to act on — the portal never had raster icons. What it does have is **13 hand-written inline SVGs** in `src/components/Icons.tsx`, which are the real thing to replace, and which is what the table below is for.

### `src/components/Icons.tsx` → registry keys

Mechanical one-for-one. **Do not apply this yet** — those components belong to the legacy console screens and are migrated in the later `styles.css` job. This table exists so that migration is find-and-replace, not design work.

| Hand-rolled | Registry key | Used by |
| --- | --- | --- |
| `IconTarget` | `map.target` | `AnalysisPanel.tsx`, `LayerRow.tsx` |
| `IconTrash` | `action.delete` | `AnalysisPanel.tsx`, `Header.tsx`, `LayerRow.tsx` |
| `IconPlus` | `action.add` | `Header.tsx` |
| `IconUpload` | `action.upload` | `Sidebar.tsx` |
| `IconPolygon` | `map.polygon` | `RedZonePanel.tsx` |
| `IconCaret` | `form.chevronDown` | `Sidebar.tsx` |
| `IconClose` | `action.close` | `Modal.tsx` |
| `IconSignOut` | `nav.logout` | `Header.tsx` |
| `IconPlay` | `action.run` | `AnalysisPanel.tsx` |
| `IconCheck` | `form.check` | `AnalysisPanel.tsx` |
| `IconCross` | `action.cancel` | `AnalysisPanel.tsx` |
| `IconDownload` | `action.download` | `AnalysisPanel.tsx`, `Header.tsx` |
| `IconGrip` | `form.dragHandle` | `Sidebar.tsx` |

`action.run` and `action.stop` were added to `icon-map.ts` specifically to cover `IconPlay` and the stop affordance the analysis panel will need.

Migration shape, per call site:

```diff
-import { IconTrash } from "./Icons";
+import { Icon } from "@/lib/icons";

-<IconTrash />
+<Icon name="action.delete" className="size-4" />
```

`Icons.tsx` can be deleted once the table is exhausted. Note the sizes will change: the hand-rolled icons carry their own `width`/`height`, whereas `<Icon>` sizes from CSS — so each call site needs a `size-*` class, which is the point.

### New components

Everything authored in this workstream (`Footer`, `RegisterPagination`, `StatusChip`, `EmptyState`, `NoResultsState`, `ErrorState`, `LoadingState`, `TableLoadingRows`, `InlineSpinner`, `AppShell`, `DatePicker`) already uses the registry exclusively. No new component imports `lucide-react`.
