import { useCallback, useMemo } from 'react';

import type { CodeValue } from '@/services/api/types';
import { useCodeValues } from '@/services/config/code-values';
import { humanizeCode } from '@/services/config/labels';
import { useLocale, useT, type Locale } from '@/services/i18n';
import {
  ACT_CODES,
  AREA_TYPE_CODES,
  CONSTRUCTION_STAGE_CODES,
  ENCROACHMENT_CODES,
  PROPERTY_TYPE_CODES,
  RECOMMENDATION_CODES,
  SECTION_CODES,
  SECTION_PARENT,
  SUPPORT_CODES,
  builtInLabelKey,
  type EnglishLabels,
  type OptionDomain,
} from '@/services/inspection/answers';

import type { WizardIconName } from './kit';

/*
 * The option lists (Figma 14–17, and the complaint form's property types). Labels come from the server's code values —
 * `label_hi` in Hindi when seeded — and fall back to the built-in wording while the
 * list has never reached this phone, so the form works on a first offline visit.
 */
const SERVER_DOMAIN: Record<OptionDomain, string> = {
  encroachment: 'encroachment_confirmed',
  support: 'external_support',
  recommendation: 'recommendation',
  areaType: 'area_type',
  constructionStage: 'construction_stage',
  propertyType: 'property_type',
  act: 'act',
  section: 'section',
};

// Domains whose codes the office may add to; any active server row is offered, not only the built-in ones.
const OPEN_DOMAINS: readonly OptionDomain[] = ['areaType', 'constructionStage', 'propertyType', 'act', 'section'];

const BUILT_IN: Record<OptionDomain, readonly string[]> = {
  encroachment: ENCROACHMENT_CODES,
  support: SUPPORT_CODES,
  recommendation: RECOMMENDATION_CODES,
  areaType: AREA_TYPE_CODES,
  constructionStage: CONSTRUCTION_STAGE_CODES,
  propertyType: PROPERTY_TYPE_CODES,
  act: ACT_CODES,
  section: SECTION_CODES,
};

// One picture per option, so the choice can be made without reading every word.
const ICONS: Record<string, WizardIconName> = {
  yes: 'yes',
  partial: 'partial',
  no_false_positive: 'no',
  none: 'none',
  police: 'police',
  survey_dept: 'survey',
  legal: 'legal',
  rcc: 'rcc',
  semi_permanent: 'semiPermanent',
  shed_hutment: 'shed',
  agricultural: 'agricultural',
  land_levelling: 'levelling',
  fencing: 'fencing',
  foundation_plinth: 'levelling',
  under_construction: 'shed',
  structure_complete: 'rcc',
  finishing: 'semiPermanent',
  completed_occupied: 'user',
  completed_vacant: 'rcc',
  residential: 'semiPermanent',
  commercial: 'rcc',
  industrial: 'shed',
  institutional: 'legal',
  vacant_land: 'levelling',
  issue_notice: 'notice',
  file_legal_case: 'legalCase',
  demolition_order: 'demolition',
  further_investigation: 'investigate',
  no_action_required: 'noAction',
  impose_fine: 'fine',
};

const FALLBACK_ICON: Record<OptionDomain, WizardIconName> = {
  encroachment: 'partial',
  support: 'none',
  recommendation: 'notice',
  areaType: 'rcc',
  constructionStage: 'rcc',
  propertyType: 'rcc',
  act: 'legal',
  section: 'note',
};

export type WizardOption = { readonly code: string; readonly label: string; readonly icon: WizardIconName };

export function optionIcon(domain: OptionDomain, code: string): WizardIconName {
  return ICONS[code] ?? FALLBACK_ICON[domain];
}

// The server row's label in the locale; Hindi only when seeded.
function rowLabel(row: CodeValue, locale: Locale): string {
  return locale === 'hi' && row.label_hi ? row.label_hi : row.label;
}

export type WizardOptions = {
  readonly options: readonly WizardOption[];
  /** False while the built-in list stands in for the server's. */
  readonly fromServer: boolean;
  readonly labelOf: (code: string) => string;
};

// The choices for one question, optionally narrowed to the codes the answers allow, or to one parent code (a section's act).
export function useWizardOptions(domain: OptionDomain, allowed?: readonly string[], parent?: string): WizardOptions {
  const query = useCodeValues(SERVER_DOMAIN[domain]);
  const locale = useLocale();
  const t = useT();
  const rows = query.data;

  const labelOf = useCallback(
    (code: string) => {
      const row = rows?.find((candidate) => candidate.code === code);
      if (row !== undefined) return rowLabel(row, locale);
      const key = builtInLabelKey(domain, code);
      return key === null ? humanizeCode(code) : t(key);
    },
    [rows, locale, domain, t],
  );

  return useMemo(() => {
    const active = (rows ?? []).filter((row) => row.active);
    const fromServer = active.length > 0;
    const codes = fromServer
      ? active
          .filter((row) => OPEN_DOMAINS.includes(domain) || BUILT_IN[domain].includes(row.code))
          .filter((row) => parent === undefined || row.parent_code === parent)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((row) => row.code)
      : BUILT_IN[domain].filter((code) => parent === undefined || SECTION_PARENT[code] === parent);
    const options = codes
      .filter((code) => allowed === undefined || allowed.includes(code))
      .map((code) => ({ code, label: labelOf(code), icon: optionIcon(domain, code) }));
    return { options, fromServer, labelOf };
  }, [rows, domain, allowed, parent, labelOf]);
}

// The server's English labels, for the generated findings lines the office reads.
export function useEnglishLabels(): EnglishLabels {
  const encroachment = useCodeValues(SERVER_DOMAIN.encroachment).data;
  const support = useCodeValues(SERVER_DOMAIN.support).data;
  const recommendation = useCodeValues(SERVER_DOMAIN.recommendation).data;
  const areaType = useCodeValues(SERVER_DOMAIN.areaType).data;
  const constructionStage = useCodeValues(SERVER_DOMAIN.constructionStage).data;
  const act = useCodeValues(SERVER_DOMAIN.act).data;
  const section = useCodeValues(SERVER_DOMAIN.section).data;
  return useMemo(() => {
    const of = (rows: readonly CodeValue[] | undefined) => (code: string) =>
      rows?.find((row) => row.code === code)?.label ?? null;
    return {
      encroachment: of(encroachment),
      support: of(support),
      recommendation: of(recommendation),
      areaType: of(areaType),
      constructionStage: of(constructionStage),
      act: of(act),
      section: of(section),
    };
  }, [encroachment, support, recommendation, areaType, constructionStage, act, section]);
}
