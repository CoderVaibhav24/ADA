/**
 * FindingsForm — step 3 (`179:7242`). The structured answers the office needs, each an
 * option list with a picture per choice (lists 14–16) or a short typed value; the
 * `findings` lines the API requires are written from these answers, not typed.
 *
 * The rules are the server's (R1–R6): "No – False Positive" hides area, sides, type, stage and
 * support; yes/partial make area, type and support required (length and width can stand in for the area); a phone (occupant's or owner's) needs a name; police help needs
 * a remark. Every field is written to the device on blur (a list on choice), and
 * checked on blur and on Next, with the problem under the field in plain words.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';

import { useInspectionDetail } from '@/services/api/inspection-reads';
import { intlLocale, useT } from '@/services/i18n';
import {
  ANSWER_FIELDS,
  MAX_NAME,
  MAX_NOTE,
  MAX_PLACE,
  PHONE_DIGITS,
  areaMismatch,
  isEnforcement,
  isHidden,
  parseArea,
  parseSide,
  roundSqm,
  sidesArea,
  validateAnswer,
  validateAnswers,
  type AnswerErrors,
  type AnswerField,
  type Answers,
} from '@/services/inspection/answers';
import {
  answersOf,
  findingsFrom,
  findingsSnapshot,
  readAnswers,
  saveAnswer,
  seedFindingsFromServer,
  subscribeToFindings,
} from '@/services/inspection/findings';

import { type LayoutStyle } from '../tokens';
import { wizardMetrics as m } from '../tokens/wizard';
import { Field, OptionSelect, TextBox } from './wizard/fields';
import { Notice, WText } from './wizard/kit';
import { optionIcon, useWizardOptions } from './wizard/options';

export type FindingsFormProps = {
  caseRef: string;
  inspectionRef: string | null;
  /** Server refusals from the last send, by form field, already in words. */
  serverErrors?: AnswerErrors;
  /** Drops a server refusal once its field is edited. */
  onServerErrorSeen?: (field: AnswerField) => void;
  /** Bumped by the screen on every Next: from then on every field's problem is shown. */
  attempt: number;
  /** Where each field sits, relative to the form's top, so the screen can scroll to a problem. */
  onFieldLayout?: (field: AnswerField, y: number) => void;
  /** The field to focus after a refused Next (a text field gets the keyboard). */
  focusField?: AnswerField | null;
  style?: LayoutStyle;
};

const TEXT_FIELDS = [
  'area_sqft',
  'length_ft',
  'width_ft',
  'occupant_name',
  'occupant_phone',
  'owner_name',
  'owner_phone',
  'floor_count',
  'police_station',
  'officer_note',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

function isTextField(field: AnswerField): field is TextField {
  return (TEXT_FIELDS as readonly string[]).includes(field);
}

// Keeps what a surveyor can type into a number: digits and one decimal mark.
function areaInput(text: string): string {
  const kept = text.replace(/[^\d.,]/g, '');
  const mark = kept.search(/[.,]/);
  if (mark < 0) return kept;
  return kept.slice(0, mark + 1) + kept.slice(mark + 1).replace(/[.,]/g, '');
}

// Keeps the ten digits of a mobile number; a +91 or 0 prefix is dropped as it is typed.
function phoneInput(text: string): string {
  let digits = text.replace(/[^\d]/g, '');
  if (digits.length > PHONE_DIGITS && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > PHONE_DIGITS && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, PHONE_DIGITS);
}

// Step 3: the answers, drafted on blur, checked against the server's rules.
export function FindingsForm({
  caseRef,
  inspectionRef,
  serverErrors,
  onServerErrorSeen,
  attempt,
  onFieldLayout,
  focusField,
  style,
}: FindingsFormProps) {
  const t = useT();
  const detail = useInspectionDetail(inspectionRef);
  const subscribe = useCallback((listener: () => void) => subscribeToFindings(caseRef, listener), [caseRef]);
  const read = useCallback(() => findingsSnapshot(caseRef), [caseRef]);
  const snapshot = useSyncExternalStore(subscribe, read);
  const stored = useMemo(() => answersOf(findingsFrom(snapshot)?.values ?? {}), [snapshot]);
  const [edits, setEdits] = useState<Partial<Answers>>({});
  // Problems found on blur; after a Next, every field's problem shows until it is edited.
  const [errors, setErrors] = useState<AnswerErrors>({});
  const [editedSince, setEditedSince] = useState<{ attempt: number; fields: readonly AnswerField[] }>({ attempt: 0, fields: [] });
  const inputs = useRef<Partial<Record<TextField, TextInput | null>>>({});

  const encroachment = useWizardOptions('encroachment');
  const areaTypes = useWizardOptions('areaType');
  const stages = useWizardOptions('constructionStage');
  const support = useWizardOptions('support');
  const propertyTypes = useWizardOptions('propertyType');

  const values: Answers = { ...stored, ...edits };

  // A round resumed on a handset with no draft starts from what the office already holds.
  useEffect(() => {
    if (detail.data !== undefined) seedFindingsFromServer(caseRef, detail.data);
  }, [caseRef, detail.data]);

  // Every keystroke is also stored, so Next never races a blur; the draft is the form's memory.
  const change = (field: AnswerField, text: string) => {
    setEdits((previous) => ({ ...previous, [field]: text }));
    if (field !== 'encroachment_confirmed_cd') saveAnswer(caseRef, field, text);
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setEditedSince((previous) =>
      previous.attempt === attempt ? { attempt, fields: [...previous.fields, field] } : { attempt, fields: [field] },
    );
    if (serverErrors?.[field] !== undefined) onServerErrorSeen?.(field);
  };

  // Writes a field, then re-checks it and any field whose rule depends on it.
  const commit = (field: AnswerField, text: string) => {
    saveAnswer(caseRef, field, text);
    setEdits((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
    const after = readAnswers(caseRef);
    setErrors((previous) => {
      const next: AnswerErrors = { ...previous, [field]: validateAnswer(field, after, 'findings') ?? undefined };
      for (const other of ANSWER_FIELDS) {
        if (other !== field && next[other] !== undefined) next[other] = validateAnswer(other, after, 'findings') ?? undefined;
      }
      return next;
    });
  };

  const choose = (field: AnswerField, code: string) => {
    change(field, code);
    commit(field, code);
  };

  // After a Next, a refused text field gets the keyboard.
  useEffect(() => {
    if (focusField !== null && focusField !== undefined && isTextField(focusField)) inputs.current[focusField]?.focus();
  }, [focusField, attempt]);

  // Problems from the last Next, except on fields edited since (cleared on edit, back on blur).
  const edited = editedSince.attempt === attempt ? editedSince.fields : [];
  const attemptErrors: AnswerErrors = attempt > 0 ? validateAnswers(stored, 'findings') : {};
  for (const field of edited) delete attemptErrors[field];

  const errorFor = (field: AnswerField): string | null => {
    const key = errors[field] ?? attemptErrors[field] ?? serverErrors?.[field];
    return key === undefined ? null : t(key);
  };
  const place = (field: AnswerField) => (y: number) => onFieldLayout?.(field, y);

  const enforcement = isEnforcement(values);
  const area = parseArea(values.area_sqft);
  const sides = sidesArea(values);
  const number = (value: number) => value.toLocaleString(intlLocale(), { maximumFractionDigits: 2 });
  const areaHint = area.ok
    ? areaMismatch(values)
      ? t('findings.area.mismatch', { sqft: number(sides?.sqft ?? 0) })
      : t('findings.area.sqm', { sqm: number(roundSqm(area.sqm)) })
    : sides !== null
      ? t('findings.sides.area', { sqft: number(sides.sqft), sqm: number(sides.sqm) })
      : enforcement
        ? t('findings.area.optional')
        : null;
  const sideHint = (field: 'length_ft' | 'width_ft'): string | null => {
    const parsed = parseSide(values[field]);
    return parsed.ok ? t('findings.side.metres', { m: number(parsed.m) }) : null;
  };
  const police = values.external_support_cd === 'police' && !isHidden('external_support_cd', values);
  const nameCount = values.occupant_name.length;

  return (
    <View style={[styles.stack, style]}>
      <Field
        label={t('findings.encroachment.label')}
        icon="partial"
        required
        error={errorFor('encroachment_confirmed_cd')}
        onLayout={place('encroachment_confirmed_cd')}
      >
        <OptionSelect
          label={t('findings.encroachment.label')}
          value={values.encroachment_confirmed_cd}
          options={encroachment.options}
          labelOf={encroachment.labelOf}
          optionIcon={(code) => optionIcon('encroachment', code)}
          invalid={errorFor('encroachment_confirmed_cd') !== null}
          onChange={(code) => choose('encroachment_confirmed_cd', code)}
        />
      </Field>

      {isHidden('area_sqft', values) ? <Notice tone="info" icon="no" body={t('findings.hidden')} live /> : null}

      {!isHidden('area_sqft', values) ? (
        <Field
          label={t('findings.area.label')}
          icon="measure"
          required={enforcement && sides === null}
          error={errorFor('area_sqft')}
          hint={areaHint}
          onLayout={place('area_sqft')}
        >
          <TextBox
            ref={(node) => {
              inputs.current.area_sqft = node;
            }}
            value={values.area_sqft}
            onChangeText={(text) => change('area_sqft', areaInput(text))}
            onBlur={() => commit('area_sqft', values.area_sqft)}
            placeholder={t('findings.area.placeholder')}
            unit={t('findings.area.unit')}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={14}
            invalid={errorFor('area_sqft') !== null}
            accessibilityLabel={`${t('findings.area.label')}, ${t('findings.area.unit')}`}
          />
        </Field>
      ) : null}

      {!isHidden('length_ft', values) ? (
        <View
          style={styles.pair}
          onLayout={(event) => {
            place('length_ft')(event.nativeEvent.layout.y);
            place('width_ft')(event.nativeEvent.layout.y);
          }}
        >
          <Field
            label={t('findings.length.label')}
            icon="measure"
            error={errorFor('length_ft')}
            hint={sideHint('length_ft')}
            style={styles.half}
          >
            <TextBox
              ref={(node) => {
                inputs.current.length_ft = node;
              }}
              value={values.length_ft}
              onChangeText={(text) => change('length_ft', areaInput(text))}
              onBlur={() => commit('length_ft', values.length_ft)}
              placeholder={t('findings.side.placeholder')}
              unit={t('findings.side.unit')}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={9}
              invalid={errorFor('length_ft') !== null}
              accessibilityLabel={`${t('findings.length.label')}, ${t('findings.side.unit')}`}
            />
          </Field>
          <Field
            label={t('findings.width.label')}
            icon="measure"
            error={errorFor('width_ft')}
            hint={sideHint('width_ft')}
            style={styles.half}
          >
            <TextBox
              ref={(node) => {
                inputs.current.width_ft = node;
              }}
              value={values.width_ft}
              onChangeText={(text) => change('width_ft', areaInput(text))}
              onBlur={() => commit('width_ft', values.width_ft)}
              placeholder={t('findings.side.placeholder')}
              unit={t('findings.side.unit')}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={9}
              invalid={errorFor('width_ft') !== null}
              accessibilityLabel={`${t('findings.width.label')}, ${t('findings.side.unit')}`}
            />
          </Field>
        </View>
      ) : null}

      {!isHidden('area_type_cd', values) ? (
        <Field
          label={t('findings.type.label')}
          icon="rcc"
          required={enforcement}
          error={errorFor('area_type_cd')}
          hint={areaTypes.fromServer ? null : t('findings.optionsOffline')}
          onLayout={place('area_type_cd')}
        >
          <OptionSelect
            label={t('findings.type.label')}
            value={values.area_type_cd}
            options={areaTypes.options}
            labelOf={areaTypes.labelOf}
            optionIcon={(code) => optionIcon('areaType', code)}
            invalid={errorFor('area_type_cd') !== null}
            onChange={(code) => choose('area_type_cd', code)}
          />
        </Field>
      ) : null}

      {!isHidden('construction_stage_cd', values) ? (
        <Field
          label={t('findings.stage.label')}
          icon="rcc"
          error={errorFor('construction_stage_cd')}
          hint={stages.fromServer ? null : t('findings.optionsOffline')}
          onLayout={place('construction_stage_cd')}
        >
          <OptionSelect
            label={t('findings.stage.label')}
            value={values.construction_stage_cd}
            options={stages.options}
            labelOf={stages.labelOf}
            optionIcon={(code) => optionIcon('constructionStage', code)}
            invalid={errorFor('construction_stage_cd') !== null}
            onChange={(code) => choose('construction_stage_cd', code)}
          />
        </Field>
      ) : null}

      {!isHidden('external_support_cd', values) ? (
        <Field
          label={t('findings.support.label')}
          icon="police"
          required={enforcement}
          error={errorFor('external_support_cd')}
          onLayout={place('external_support_cd')}
        >
          <OptionSelect
            label={t('findings.support.label')}
            value={values.external_support_cd}
            options={support.options}
            labelOf={support.labelOf}
            optionIcon={(code) => optionIcon('support', code)}
            invalid={errorFor('external_support_cd') !== null}
            onChange={(code) => choose('external_support_cd', code)}
          />
        </Field>
      ) : null}

      <Field
        label={t('findings.name.label')}
        icon="user"
        required={values.occupant_phone.trim() !== ''}
        error={errorFor('occupant_name')}
        hint={nameCount >= MAX_NAME - 50 ? t('findings.note.count', { count: nameCount, max: MAX_NAME }) : null}
        onLayout={place('occupant_name')}
      >
        <TextBox
          ref={(node) => {
            inputs.current.occupant_name = node;
          }}
          value={values.occupant_name}
          onChangeText={(text) => change('occupant_name', text)}
          onBlur={() => commit('occupant_name', values.occupant_name)}
          placeholder={t('findings.name.placeholder')}
          autoCapitalize="words"
          textContentType="name"
          maxLength={MAX_NAME}
          invalid={errorFor('occupant_name') !== null}
          accessibilityLabel={t('findings.name.label')}
        />
      </Field>

      <Field
        label={t('findings.phone.label')}
        icon="phone"
        error={errorFor('occupant_phone')}
        onLayout={place('occupant_phone')}
      >
        <TextBox
          ref={(node) => {
            inputs.current.occupant_phone = node;
          }}
          value={values.occupant_phone}
          onChangeText={(text) => change('occupant_phone', phoneInput(text))}
          onBlur={() => commit('occupant_phone', values.occupant_phone)}
          placeholder={t('findings.phone.placeholder')}
          keyboardType="phone-pad"
          inputMode="tel"
          textContentType="telephoneNumber"
          maxLength={PHONE_DIGITS}
          invalid={errorFor('occupant_phone') !== null}
          accessibilityLabel={t('findings.phone.label')}
        />
      </Field>

      <Field
        label={t('findings.owner.label')}
        icon="user"
        required={values.owner_phone.trim() !== ''}
        error={errorFor('owner_name')}
        onLayout={place('owner_name')}
      >
        <TextBox
          ref={(node) => {
            inputs.current.owner_name = node;
          }}
          value={values.owner_name}
          onChangeText={(text) => change('owner_name', text)}
          onBlur={() => commit('owner_name', values.owner_name)}
          placeholder={t('findings.owner.placeholder')}
          autoCapitalize="words"
          textContentType="name"
          maxLength={MAX_NAME}
          invalid={errorFor('owner_name') !== null}
          accessibilityLabel={t('findings.owner.label')}
        />
      </Field>

      <Field
        label={t('findings.ownerPhone.label')}
        icon="phone"
        error={errorFor('owner_phone')}
        onLayout={place('owner_phone')}
      >
        <TextBox
          ref={(node) => {
            inputs.current.owner_phone = node;
          }}
          value={values.owner_phone}
          onChangeText={(text) => change('owner_phone', phoneInput(text))}
          onBlur={() => commit('owner_phone', values.owner_phone)}
          placeholder={t('findings.phone.placeholder')}
          keyboardType="phone-pad"
          inputMode="tel"
          textContentType="telephoneNumber"
          maxLength={PHONE_DIGITS}
          invalid={errorFor('owner_phone') !== null}
          accessibilityLabel={t('findings.ownerPhone.label')}
        />
      </Field>

      <Field
        label={t('findings.propertyType.label')}
        icon="semiPermanent"
        error={errorFor('property_type_cd')}
        hint={propertyTypes.fromServer ? null : t('findings.optionsOffline')}
        onLayout={place('property_type_cd')}
      >
        <OptionSelect
          label={t('findings.propertyType.label')}
          value={values.property_type_cd}
          options={propertyTypes.options}
          labelOf={propertyTypes.labelOf}
          optionIcon={(code) => optionIcon('propertyType', code)}
          invalid={errorFor('property_type_cd') !== null}
          onChange={(code) => choose('property_type_cd', code)}
        />
      </Field>

      <Field label={t('findings.floors.label')} icon="rcc" error={errorFor('floor_count')} onLayout={place('floor_count')}>
        <TextBox
          ref={(node) => {
            inputs.current.floor_count = node;
          }}
          value={values.floor_count}
          onChangeText={(text) => change('floor_count', text.replace(/[^\d]/g, ''))}
          onBlur={() => commit('floor_count', values.floor_count)}
          placeholder={t('findings.floors.placeholder')}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={3}
          invalid={errorFor('floor_count') !== null}
          accessibilityLabel={t('findings.floors.label')}
        />
      </Field>

      <Field
        label={t('findings.police.label')}
        icon="police"
        error={errorFor('police_station')}
        onLayout={place('police_station')}
      >
        <TextBox
          ref={(node) => {
            inputs.current.police_station = node;
          }}
          value={values.police_station}
          onChangeText={(text) => change('police_station', text)}
          onBlur={() => commit('police_station', values.police_station)}
          placeholder={t('findings.police.placeholder')}
          autoCapitalize="words"
          maxLength={MAX_PLACE}
          invalid={errorFor('police_station') !== null}
          accessibilityLabel={t('findings.police.label')}
        />
      </Field>

      <Field
        label={t('findings.note.label')}
        icon="note"
        required={police}
        error={errorFor('officer_note')}
        hint={police ? t('findings.note.police') : null}
        onLayout={place('officer_note')}
      >
        <TextBox
          ref={(node) => {
            inputs.current.officer_note = node;
          }}
          value={values.officer_note}
          onChangeText={(text) => change('officer_note', text)}
          onBlur={() => commit('officer_note', values.officer_note)}
          placeholder={t('findings.note.placeholder')}
          multiline
          maxLength={MAX_NOTE}
          invalid={errorFor('officer_note') !== null}
          accessibilityLabel={t('findings.note.label')}
        />
        <WText variant="caption" color="beige" align="right">
          {t('findings.note.count', { count: values.officer_note.length, max: MAX_NOTE })}
        </WText>
      </Field>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: m.fieldGap, paddingTop: 6 },
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
});
