import { createContext, use, type ComponentType } from "react";
import { KhasraParcelIcon } from "@/assets/icons/KhasraParcelIcon";
import { ICON_DATA, ICON_FALLBACKS } from "./icon-data.generated";
import {
  DEFAULT_ICON_SET,
  ICON_MAP,
  ICON_SETS,
  iconIdFor,
  type IconKey,
  type IconSetId,
} from "./icon-map";
import type { LocalIconProps } from "./types";

export { ICON_SETS, ICON_MAP, DEFAULT_ICON_SET };
export type { IconKey, IconSetId };
export const ICON_KEYS = Object.keys(ICON_MAP) as IconKey[];

export const LOCAL_ICONS: Partial<Record<IconKey, ComponentType<LocalIconProps>>> = {
  "map.parcel": KhasraParcelIcon,
};

export const IconSetContext = createContext<IconSetId>(DEFAULT_ICON_SET);

export function useIconSet(): IconSetId {
  return use(IconSetContext);
}

export function resolveIconId(key: IconKey, set: IconSetId = DEFAULT_ICON_SET): string {
  if (LOCAL_ICONS[key]) return `local:${key}`;
  const id = iconIdFor(key, set);
  if (!ICON_DATA[id]) return iconIdFor(key, DEFAULT_ICON_SET);
  return id;
}

export function isFallback(key: IconKey, set: IconSetId): boolean {
  return Boolean(ICON_FALLBACKS[set]?.[key]);
}
