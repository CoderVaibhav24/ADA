import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { caseKeys } from './case-reads';
import { inspectionKeys } from './inspection-reads';

/*
 * Search over what this phone already holds: every case and inspection row the
 * query cache has seen (the cache is persisted, so this works offline). Nothing is
 * fetched: a surveyor with no signal still finds the case they opened this morning.
 * The server has a `q` filter for the register; this is the offline complement.
 */

export type CaseHit = {
  readonly kind: 'case';
  readonly caseRef: string;
  readonly title: string | null;
  readonly place: string | null;
  readonly parcel: string | null;
  readonly status: string | null;
};

export type InspectionHit = {
  readonly kind: 'inspection';
  readonly caseRef: string;
  readonly inspectionRef: string;
  readonly place: string | null;
  readonly roundNo: number | null;
  readonly submittedAt: string | null;
  readonly status: string | null;
};

export type SearchHits = { readonly cases: readonly CaseHit[]; readonly inspections: readonly InspectionHit[] };

type Loose = Record<string, unknown>;

// The fields a surveyor searches by: case number, place, plot.
const SEARCHED = [
  'case_ref',
  'inspection_ref',
  'property_address',
  'landmark',
  'zone_name',
  'village_name',
  'parcel_id',
  'khasra_no',
  'ulpin',
  'case_title',
  'complaint_type_label',
] as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

// Every object in a cached value that carries a case reference: rows, pages, details.
function collect(value: unknown, into: Loose[], depth = 0): void {
  if (depth > 4 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, depth + 1);
    return;
  }
  const record = value as Loose;
  if (typeof record.case_ref === 'string') into.push(record);
  for (const key of ['pages', 'items']) {
    if (key in record) collect(record[key], into, depth + 1);
  }
}

// Folds spaces, dashes and case so "cmp 4512" finds "CMP-4512".
function fold(value: string): string {
  return value.toLowerCase().replace(/[\s\-_/.,]+/g, '');
}

function matches(record: Loose, needle: string): boolean {
  return SEARCHED.some((key) => {
    const value = text(record[key]);
    return value !== null && fold(value).includes(needle);
  });
}

// Reads every cached case and inspection row and keeps the ones that match.
export function searchCache(rows: readonly Loose[], query: string): SearchHits {
  const needle = fold(query.trim());
  if (needle === '') return { cases: [], inspections: [] };
  const cases = new Map<string, CaseHit>();
  const inspections = new Map<string, InspectionHit>();
  for (const record of rows) {
    if (!matches(record, needle)) continue;
    const caseRef = record.case_ref as string;
    const inspectionRef = text(record.inspection_ref);
    if (inspectionRef !== null) {
      if (!inspections.has(inspectionRef)) {
        inspections.set(inspectionRef, {
          kind: 'inspection',
          caseRef,
          inspectionRef,
          place: text(record.case_title) ?? text(record.zone_name),
          roundNo: typeof record.round_no === 'number' ? record.round_no : null,
          submittedAt: text(record.submitted_at),
          status: text(record.status),
        });
      }
      continue;
    }
    const previous = cases.get(caseRef);
    cases.set(caseRef, {
      kind: 'case',
      caseRef,
      title: previous?.title ?? text(record.complaint_type_label) ?? text(record.other_type),
      place: previous?.place ?? text(record.property_address) ?? text(record.landmark) ?? text(record.zone_name),
      parcel: previous?.parcel ?? text(record.parcel_id) ?? text(record.khasra_no),
      status: previous?.status ?? text(record.status),
    });
  }
  return { cases: [...cases.values()], inspections: [...inspections.values()] };
}

// The cached rows, re-read whenever the query cache changes.
function useCachedRows(): Loose[] {
  const client = useQueryClient();
  const [version, setVersion] = useState(0);
  useEffect(() => client.getQueryCache().subscribe(() => setVersion((current) => current + 1)), [client]);
  return useMemo(() => {
    void version;
    const rows: Loose[] = [];
    for (const [, data] of client.getQueriesData({ queryKey: caseKeys.all })) collect(data, rows);
    for (const [, data] of client.getQueriesData({ queryKey: inspectionKeys.all })) collect(data, rows);
    return rows;
  }, [client, version]);
}

// Matches for a query among the cached rows; empty for an empty query.
export function useCacheSearch(query: string): SearchHits {
  const rows = useCachedRows();
  return useMemo(() => searchCache(rows, query), [rows, query]);
}
