/*
 * The shapes a screen definition is made of. docs/Agents-Mobile/sdui.md is the
 * reference. The server has already validated a served definition; the guards here
 * are for the parts the renderer branches on, so a malformed node is skipped rather
 * than read as something it is not.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type QueryLiteral = string | number | boolean | null | readonly (string | number)[];

export type SduiBinding = {
  readonly source: 'api';
  readonly path: string;
  readonly query?: Readonly<Record<string, QueryLiteral>>;
  readonly select?: string;
};

export type SduiConfirm = {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
};

export type SduiAction =
  | {
      readonly type: 'navigate';
      readonly route?: string;
      readonly screen?: string;
      readonly params?: Readonly<Record<string, string>>;
    }
  | { readonly type: 'refresh' }
  | { readonly type: 'open_url'; readonly url: string }
  | {
      readonly type: 'call_api';
      readonly path: string;
      readonly body?: Readonly<Record<string, JsonValue>>;
      readonly confirm: SduiConfirm;
      readonly then?: 'refresh' | 'none';
    };

export type SduiNode = {
  readonly type: string;
  readonly id?: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children?: readonly unknown[];
  readonly data?: SduiBinding;
  readonly action?: SduiAction;
  readonly visibleIf?: string;
  readonly item?: unknown;
  readonly empty?: unknown;
};

export type ScreenDefinition = {
  readonly title: string;
  readonly body: readonly unknown[];
};

/** `GET /api/app/screens/{id}`, as the app caches it. */
export type ScreenEnvelope = {
  readonly screen_id: string;
  readonly version: number;
  readonly schema_version: number;
  readonly min_app_runtime: string;
  readonly title: string;
  readonly definition: ScreenDefinition;
  readonly etag: string;
  readonly published_at: string;
};

export type ScreenIndexItem = {
  readonly screen_id: string;
  readonly version: number;
  readonly title: string;
  readonly min_app_runtime: string;
  readonly etag: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A node is anything with a string `type`; everything else about it is read defensively.
export function asNode(value: unknown): SduiNode | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  return value as SduiNode;
}

export function asBinding(value: unknown): SduiBinding | null {
  if (!isRecord(value) || value.source !== 'api' || typeof value.path !== 'string') return null;
  if (value.query !== undefined && !isRecord(value.query)) return null;
  if (value.select !== undefined && typeof value.select !== 'string') return null;
  return value as SduiBinding;
}

function isDefinition(value: unknown): value is ScreenDefinition {
  return isRecord(value) && typeof value.title === 'string' && Array.isArray(value.body);
}

// The served envelope, or null for anything that is not one.
export function asEnvelope(value: unknown): ScreenEnvelope | null {
  if (!isRecord(value)) return null;
  const ok =
    typeof value.screen_id === 'string' &&
    typeof value.version === 'number' &&
    typeof value.schema_version === 'number' &&
    typeof value.min_app_runtime === 'string' &&
    typeof value.title === 'string' &&
    typeof value.etag === 'string' &&
    typeof value.published_at === 'string' &&
    isDefinition(value.definition);
  return ok ? (value as ScreenEnvelope) : null;
}

export function asIndexItems(value: unknown): ScreenIndexItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.filter(
    (item): item is ScreenIndexItem =>
      isRecord(item) &&
      typeof item.screen_id === 'string' &&
      typeof item.version === 'number' &&
      typeof item.title === 'string',
  );
}
