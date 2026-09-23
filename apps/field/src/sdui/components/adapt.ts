import {
  colors,
  iconNames,
  iconSize,
  space,
  typography,
  type ColorToken,
  type IconName,
  type IconSizeToken,
  type SpaceToken,
  type TypographyVariant,
} from '@/design-system';

/*
 * Prop adapters: served values in, design-system prop types out. Each answers
 * undefined for anything it does not recognise, so the component falls back to its
 * own default instead of receiving a value its type does not allow. Enumerations are
 * checked against the design system itself, not against the contract's copy.
 */

export function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function text(value: unknown): string {
  return str(value) ?? '';
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function int(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

export function num(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function oneOf<T extends string>(value: unknown, members: readonly T[]): T | undefined {
  return typeof value === 'string' && (members as readonly string[]).includes(value) ? (value as T) : undefined;
}

function isKey<T extends object>(value: unknown, table: T): value is keyof T {
  return (
    (typeof value === 'string' || typeof value === 'number') &&
    Object.prototype.hasOwnProperty.call(table, value)
  );
}

export function colorToken(value: unknown): ColorToken | undefined {
  return isKey(value, colors) ? value : undefined;
}

export function iconName(value: unknown): IconName | undefined {
  return oneOf(value, iconNames);
}

export function iconSizeToken(value: unknown): IconSizeToken | undefined {
  return isKey(value, iconSize) ? value : undefined;
}

export function spaceToken(value: unknown): SpaceToken | undefined {
  return isKey(value, space) ? (Number(value) as SpaceToken) : undefined;
}

export function textVariant(value: unknown): TypographyVariant | undefined {
  return isKey(value, typography) ? value : undefined;
}
