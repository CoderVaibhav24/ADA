import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { Icon as Iconify } from "@iconify/react";
import { ICON_DATA } from "./icon-data.generated";
import {
  IconSetContext,
  LOCAL_ICONS,
  resolveIconId,
  useIconSet,
  type IconKey,
  type IconSetId,
} from "./resolve";

export function IconSetProvider({
  set,
  children,
}: {
  set: IconSetId;
  children: ReactNode;
}) {
  return <IconSetContext value={set}>{children}</IconSetContext>;
}

export type IconProps = {
  name: IconKey;
  className?: string;
  set?: IconSetId;
  label?: string;
  spin?: boolean;
  style?: CSSProperties;
  id?: string;
  onClick?: MouseEventHandler<SVGSVGElement>;
} & { [dataAttr: `data-${string}`]: string | number | boolean | undefined };

export function Icon({ name, className, set, label, spin, ...rest }: IconProps) {
  const contextSet = useIconSet();
  const active = set ?? contextSet;

  const a11y = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true, focusable: false } as const);

  const Local = LOCAL_ICONS[name];
  const cls = [spin ? "animate-spin" : null, className].filter(Boolean).join(" ") || undefined;
  const passthrough = rest as Record<string, unknown>;

  if (Local) return <Local className={cls} {...a11y} {...passthrough} />;
  const id = resolveIconId(name, active);
  const data = ICON_DATA[id];

  if (!data) {
    if (import.meta.env.DEV) {
      console.warn(`[icons] "${name}" -> "${id}" is not bundled. Run: npm run icons:build`);
    }
    return null;
  }

  return <Iconify icon={data} className={cls} {...a11y} {...passthrough} />;
}
