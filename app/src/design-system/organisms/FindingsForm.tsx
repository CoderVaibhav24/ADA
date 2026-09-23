/**
 * FindingsForm — step 3 (`179:7242`). Every field the inspection contract accepts
 * (`FindingsPut`), each written to the local draft on blur so a killed app loses
 * nothing (ui-rules.md §5). Option lists come from the server's code values.
 *
 * The draft is the form's memory: the form restores from it, the gate reads it, and
 * the screen sends it. Component state only holds what is being typed.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorText } from '@/services/api/error-text';
import { useInspectionDetail } from '@/services/api/inspection-reads';
import { useCodeValues } from '@/services/config/code-values';
import { formatDateTime } from '@/services/format/datetime';
import {
  FINDINGS_FIELDS,
  draftText,
  findingsFrom,
  findingsSnapshot,
  saveFindingsField,
  seedFindingsFromServer,
  subscribeToFindings,
  validateFindings,
  validateFindingsField,
  type FindingsErrors,
  type FindingsField,
} from '@/services/inspection/findings';

import { Input, Select, Text, TextArea, type SelectOption } from '../atoms';
import { FormField } from '../molecules';
import { space, type LayoutStyle } from '../tokens';

export type FindingsGate = { readonly ready: boolean; readonly reason: string | null };

export type FindingsFormProps = {
  caseRef: string;
  inspectionRef: string | null;
  /** Server refusals from the last send, keyed by the field the server named. */
  serverErrors?: FindingsErrors;
  /** Tells the screen whether Next may enable, and if not, why. Pass a stable function. */
  onGateChange: (gate: FindingsGate) => void;
  style?: LayoutStyle;
};

type Values = Record<FindingsField, string>;

// A yes/no answer for the boolean `notice_required`; the labels are the question's own words.
const NOTICE_OPTIONS: readonly SelectOption[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

// Step 3: drafts on every blur, restores on resume, gates on what was stored.
export function FindingsForm({ caseRef, inspectionRef, serverErrors, onGateChange, style }: FindingsFormProps) {
  const detail = useInspectionDetail(inspectionRef);
  const areaTypes = useCodeValues('area_type');
  // What is stored is what renders; `edits` holds only the text of a field being typed.
  const subscribe = useCallback((listener: () => void) => subscribeToFindings(caseRef, listener), [caseRef]);
  const read = useCallback(() => findingsSnapshot(caseRef), [caseRef]);
  const snapshot = useSyncExternalStore(subscribe, read);
  const draft = useMemo(() => findingsFrom(snapshot), [snapshot]);
  const [edits, setEdits] = useState<Partial<Values>>({});
  const [errors, setErrors] = useState<FindingsErrors>({});

  const values = {} as Values;
  for (const field of FINDINGS_FIELDS) values[field] = edits[field] ?? draftText(draft?.values ?? {}, field);
  const savedAt = draft?.updatedAt ?? null;

  // A round resumed on a handset with no draft starts from what the office already holds.
  useEffect(() => {
    if (detail.data !== undefined) seedFindingsFromServer(caseRef, detail.data);
  }, [caseRef, detail.data]);

  // The gate reads the stored draft, never the text being typed.
  const storedErrors = validateFindings(draft?.values ?? {});
  const firstStored = Object.values(storedErrors)[0] ?? null;
  const ready = firstStored === null;
  useEffect(() => {
    onGateChange({ ready, reason: firstStored });
  }, [onGateChange, ready, firstStored]);

  const change = (field: FindingsField, value: string) =>
    setEdits((previous) => ({ ...previous, [field]: value }));

  // Writes the field to the draft, drops the in-flight text, and states any problem with it.
  const commit = (field: FindingsField, value: string) => {
    saveFindingsField(caseRef, field, value);
    setEdits((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
    setErrors((previous) => ({ ...previous, [field]: validateFindingsField(field, value) ?? undefined }));
  };

  const errorFor = (field: FindingsField) => errors[field] ?? serverErrors?.[field];

  const areaOptions: SelectOption[] = (areaTypes.data ?? []).map((row) => ({
    value: row.code,
    label: row.label_hi ? `${row.label} / ${row.label_hi}` : row.label,
  }));
  const areaHint = areaTypes.isPending
    ? 'Loading the area types from the server…'
    : areaTypes.isError
      ? `Area types could not be loaded: ${errorText(areaTypes.error).message}`
      : areaOptions.length === 0
        ? 'The server has no area types configured.'
        : undefined;

  return (
    <View style={[styles.stack, style]}>
      <FormField
        label="Findings"
        required
        hint="One finding per line — what you observed at the site."
        error={errorFor('findings')}
      >
        <TextArea
          value={values.findings}
          onChangeText={(text) => change('findings', text)}
          onBlur={() => commit('findings', values.findings)}
          invalid={errorFor('findings') !== undefined}
          rows={5}
          accessibilityLabel="Findings, one per line"
        />
      </FormField>

      <FormField
        label="Measured area (square metres)"
        hint="As measured on site."
        error={errorFor('measured_area_sqm')}
      >
        <Input
          value={values.measured_area_sqm}
          onChangeText={(text) => change('measured_area_sqm', text)}
          onBlur={() => commit('measured_area_sqm', values.measured_area_sqm)}
          keyboardType="decimal-pad"
          invalid={errorFor('measured_area_sqm') !== undefined}
          accessibilityLabel="Measured area in square metres"
        />
      </FormField>

      <FormField label="Area type" hint={areaHint} error={errorFor('area_type_cd')}>
        <Select
          options={areaOptions}
          value={values.area_type_cd === '' ? undefined : values.area_type_cd}
          onChange={(code) => {
            change('area_type_cd', code);
            commit('area_type_cd', code);
          }}
          disabled={areaOptions.length === 0}
          placeholder="Select the area type"
          accessibilityLabel="Area type"
        />
      </FormField>

      <FormField label="Occupant name" error={errorFor('occupant_name')}>
        <Input
          value={values.occupant_name}
          onChangeText={(text) => change('occupant_name', text)}
          onBlur={() => commit('occupant_name', values.occupant_name)}
          autoCapitalize="words"
          textContentType="name"
          invalid={errorFor('occupant_name') !== undefined}
          accessibilityLabel="Occupant name"
        />
      </FormField>

      <FormField label="Occupant contact" hint="10-digit mobile number." error={errorFor('occupant_phone')}>
        <Input
          value={values.occupant_phone}
          onChangeText={(text) => change('occupant_phone', text)}
          onBlur={() => commit('occupant_phone', values.occupant_phone)}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          invalid={errorFor('occupant_phone') !== undefined}
          accessibilityLabel="Occupant mobile number"
        />
      </FormField>

      <FormField label="Notice required" error={errorFor('notice_required')}>
        <Select
          options={NOTICE_OPTIONS}
          value={values.notice_required === '' ? undefined : values.notice_required}
          onChange={(answer) => {
            change('notice_required', answer);
            commit('notice_required', answer);
          }}
          placeholder="Select yes or no"
          accessibilityLabel="Notice required"
        />
      </FormField>

      <FormField label="Remarks" error={errorFor('officer_note')}>
        <TextArea
          value={values.officer_note}
          onChangeText={(text) => change('officer_note', text)}
          onBlur={() => commit('officer_note', values.officer_note)}
          invalid={errorFor('officer_note') !== undefined}
          accessibilityLabel="Remarks"
        />
      </FormField>

      <Text variant="caption" color="ink3" accessibilityLiveRegion="polite">
        {savedAt === null
          ? 'Each field is saved on this device when you leave it.'
          : `Saved on this device ${formatDateTime(savedAt) ?? ''}.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[5] },
});
