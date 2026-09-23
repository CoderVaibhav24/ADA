import { formatAge, formatDate, formatDateTime } from '@/services/format/datetime';

/*
 * Template strings: `{{item.case_ref}}`, `{{data|number}}`, `{{item.status|label:case_status}}`.
 *
 * This is the whole expression language: a dotted path looked up over own
 * properties, and one formatter from a fixed list. There is no eval, no `Function`,
 * no operators and no calls — an expression the grammar does not match renders as
 * an empty string. Prototype members are refused, so `{{item.constructor}}` is
 * nothing rather than a function.
 */

export type Scope = {
  readonly params: Readonly<Record<string, string>>;
  /** The device's calendar day as `YYYY-MM-DD`, for date-bounded queries. */
  readonly today: string;
  readonly data?: unknown;
  readonly item?: unknown;
  readonly index?: number;
};

export type Labeller = (domain: string, code: string) => string;

const TEMPLATE = /\{\{(.*?)\}\}/g;
const WHOLE = /^\{\{(.*?)\}\}$/;
const EXPRESSION =
  /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\s*(?:\|\s*([a-z]+)(?::([a-z][a-z0-9_]{0,39}))?\s*)?$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const ROOTS = new Set(['params', 'today', 'data', 'item', 'index']);

// Walks own properties only; any segment that is absent or forbidden answers undefined.
export function lookup(scope: Scope, path: string): unknown {
  const segments = path.split('.');
  const root = segments[0];
  if (root === undefined || !ROOTS.has(root)) return undefined;
  let current: unknown = (scope as Record<string, unknown>)[root];
  for (const segment of segments.slice(1)) {
    if (FORBIDDEN.has(segment) || current === null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

// A value as text on screen. Objects and arrays never render: a dump of a record is not a label.
export function toDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return '';
}

function format(value: unknown, formatter: string, argument: string | undefined, labeller: Labeller): unknown {
  if (value === null || value === undefined || value === '') return '';
  switch (formatter) {
    case 'date':
      return formatDate(toDisplay(value)) ?? '';
    case 'datetime':
      return formatDateTime(toDisplay(value)) ?? '';
    case 'age':
      return formatAge(toDisplay(value)) ?? '';
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(toDisplay(value));
      return Number.isFinite(numeric) ? numeric.toLocaleString() : '';
    }
    case 'label':
      return argument === undefined ? toDisplay(value) : labeller(argument, toDisplay(value));
    default:
      return '';
  }
}

// One expression's value, formatted; undefined when the expression is not in the grammar.
export function evaluate(expression: string, scope: Scope, labeller: Labeller): unknown {
  const match = EXPRESSION.exec(expression);
  if (match === null) return undefined;
  const [, path, formatter, argument] = match;
  if (path === undefined) return undefined;
  const value = lookup(scope, path);
  return formatter === undefined ? value : format(value, formatter, argument, labeller);
}

/*
 * Resolves a prop value. A string that is exactly one template keeps the value's
 * type (a count stays a number); a string mixing text and templates becomes text.
 * Non-strings pass through untouched.
 */
export function interpolate(value: unknown, scope: Scope, labeller: Labeller): unknown {
  if (typeof value !== 'string' || !value.includes('{{')) return value;
  const whole = WHOLE.exec(value);
  if (whole !== null && whole[1] !== undefined && !whole[1].includes('{{')) {
    return evaluate(whole[1], scope, labeller);
  }
  return value.replace(TEMPLATE, (_match, expression: string) =>
    toDisplay(evaluate(expression, scope, labeller)),
  );
}

// Every code-value domain a definition's `label:` formatters name, so they can be fetched up front.
export function labelDomains(definition: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\|\s*label:([a-z][a-z0-9_]{0,39})\s*\}\}/g)) {
        if (match[1] !== undefined) found.add(match[1]);
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(definition);
  return [...found].sort();
}
