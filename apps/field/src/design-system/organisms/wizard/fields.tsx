/**
 * Form controls for steps 3 and 4: the text box (179:7368), the select and its open
 * list (179:7445 and the three frames that reuse it). The list opens inline under the
 * field, as the frames draw it, with an icon per option and large rows.
 */

import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useScriptOf, useT } from '@/services/i18n';

import { type LayoutStyle } from '../../tokens';
import { wizardColors, wizardMetrics as m, wizardText } from '../../tokens';
import { FieldError, FieldLabel, Glyph, WIcon, WText, type WizardIconName } from './kit';
import type { WizardOption } from './options';

// ---------------------------------------------------------------- field shell

export type FieldProps = {
  label: string;
  icon: WizardIconName;
  required?: boolean;
  error?: string | null;
  hint?: string | null;
  children: React.ReactNode;
  onLayout?: (y: number) => void;
  style?: LayoutStyle;
};

// Label, control, then the hint or the problem under it (label gap 6, 179:7368).
export function Field({ label, icon, required, error, hint, children, onLayout, style }: FieldProps) {
  return (
    <View style={[styles.field, style]} onLayout={(event) => onLayout?.(event.nativeEvent.layout.y)}>
      <FieldLabel label={label} icon={icon} required={required} />
      {children}
      {error ? (
        <FieldError message={error} />
      ) : hint ? (
        <WText variant="caption" color="beige">
          {hint}
        </WText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- text box

export type TextBoxProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  invalid?: boolean;
  unit?: string;
  multiline?: boolean;
};

// The 179:7368 input: beige fill, brown border, radius 12; a unit suffix sits at right 14.
export const TextBox = forwardRef<TextInput, TextBoxProps>(function TextBox(
  { invalid = false, unit, multiline = false, value, placeholder, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const script = useScriptOf(value && value !== '' ? value : (placeholder ?? ''));
  const border = invalid ? 'inputBorderError' : focused ? 'inputBorderFocus' : 'inputBorder';
  return (
    <View style={[styles.box, multiline ? styles.area : null, { borderColor: wizardColors[border] }, invalid ? styles.boxInvalid : null]}>
      <TextInput
        ref={ref}
        {...rest}
        value={value}
        placeholder={placeholder}
        multiline={multiline}
        placeholderTextColor={wizardColors.placeholder}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[
          wizardText('input', 'white', script),
          styles.input,
          multiline ? styles.inputArea : null,
          unit ? styles.inputWithUnit : null,
        ]}
      />
      {unit ? (
        <View style={styles.unit} pointerEvents="none">
          <WText variant="unit" color="unit">
            {unit}
          </WText>
        </View>
      ) : null}
      {multiline ? (
        <View style={styles.grip} pointerEvents="none">
          <Glyph name="grip" color="grip" />
        </View>
      ) : null}
    </View>
  );
});

// ---------------------------------------------------------------- select

export type OptionSelectProps = {
  label: string;
  value: string;
  options: readonly WizardOption[];
  onChange: (code: string) => void;
  labelOf: (code: string) => string;
  optionIcon: (code: string) => WizardIconName;
  invalid?: boolean;
  /** Shown but not changeable (a recommendation fixed by the answers). */
  locked?: boolean;
};

// Closed: the 179:7368 control with a chevron. Open: 179:7445, rows of icon + label, tick on the chosen one.
export function OptionSelect({ label, value, options, onChange, labelOf, optionIcon, invalid = false, locked = false }: OptionSelectProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const chosen = value === '' ? null : value;
  const shown = chosen === null ? t('common.select') : labelOf(chosen);

  const trigger = (
    <Pressable
      onPress={() => (locked ? undefined : setOpen((was) => !was))}
      disabled={locked}
      accessibilityRole="button"
      accessibilityLabel={t('wizard.select.a11y', { label, value: shown })}
      accessibilityHint={locked ? undefined : open ? t('wizard.select.close') : t('wizard.select.hint')}
      accessibilityState={{ expanded: open, disabled: locked }}
      style={[
        styles.box,
        styles.trigger,
        { borderColor: wizardColors[invalid ? 'inputBorderError' : open ? 'inputBorderFocus' : 'inputBorder'] },
        invalid ? styles.boxInvalid : null,
      ]}
    >
      {chosen !== null ? <WIcon name={optionIcon(chosen)} size={20} color="white" /> : null}
      <WText variant="input" color={chosen === null ? 'placeholder' : 'white'} numberOfLines={2} style={styles.flex}>
        {shown}
      </WText>
      {locked ? null : (
        <View style={[styles.chevron, open ? styles.chevronOpen : null]}>
          <Glyph name="chevronDown" color="chevron" />
        </View>
      )}
    </Pressable>
  );

  if (!open) return trigger;

  return (
    <View style={styles.list}>
      {trigger}
      <View accessibilityRole="list">
        {options.map((option, index) => {
          const selected = option.code === chosen;
          const last = index === options.length - 1;
          return (
            <Pressable
              key={option.code}
              onPress={() => {
                setOpen(false);
                onChange(option.code);
              }}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, checked: selected }}
              style={({ pressed }) => [
                styles.row,
                last ? styles.rowLast : null,
                selected || pressed ? styles.rowSelected : null,
              ]}
            >
              <WIcon name={option.icon} size={m.optionIcon} color={selected ? 'listSelected' : 'listInk'} />
              <WText variant="option" color={selected ? 'white' : 'listInk'} style={styles.flex}>
                {option.label}
              </WText>
              {selected ? <Glyph name="tick" size={20} color="listSelected" /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export type OptionChecklistProps = {
  options: readonly WizardOption[];
  selected: readonly string[];
  onToggle: (code: string) => void;
  invalid?: boolean;
  locked?: boolean;
};

// Several choices at once (the legacy sections MultiSelect): always open, a tick on each chosen row.
export function OptionChecklist({ options, selected, onToggle, invalid = false, locked = false }: OptionChecklistProps) {
  return (
    <View style={[styles.list, invalid ? styles.listInvalid : null]} accessibilityRole="list">
      {options.map((option, index) => {
        const checked = selected.includes(option.code);
        return (
          <Pressable
            key={option.code}
            onPress={() => (locked ? undefined : onToggle(option.code))}
            disabled={locked}
            accessibilityRole="checkbox"
            accessibilityLabel={option.label}
            accessibilityState={{ checked, disabled: locked }}
            style={({ pressed }) => [
              styles.row,
              index === options.length - 1 ? styles.rowLast : null,
              checked || pressed ? styles.rowSelected : null,
            ]}
          >
            <WIcon name={option.icon} size={m.optionIcon} color={checked ? 'listSelected' : 'listInk'} />
            <WText variant="option" color={checked ? 'white' : 'listInk'} style={styles.flex}>
              {option.label}
            </WText>
            {checked ? <Glyph name="tick" size={20} color="listSelected" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listInvalid: { borderWidth: 2, borderColor: wizardColors.inputBorderError },
  field: { gap: m.labelGap },
  box: {
    minHeight: m.control,
    borderRadius: m.controlRadius,
    borderWidth: m.hairline,
    backgroundColor: wizardColors.inputFill,
    justifyContent: 'center',
  },
  boxInvalid: { borderWidth: 2 },
  area: { minHeight: m.textArea },
  input: { paddingLeft: m.controlPadLeft, paddingRight: m.controlPadLeft, paddingVertical: 12, minHeight: m.control },
  inputArea: { minHeight: m.textArea, paddingTop: 12, paddingBottom: 28, paddingHorizontal: 13 },
  inputWithUnit: { paddingRight: 64 },
  unit: { position: 'absolute', right: m.unitRight, top: 0, bottom: 0, justifyContent: 'center' },
  grip: { position: 'absolute', right: 8, bottom: 8 },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: m.controlPadLeft,
    paddingRight: m.controlPadRight,
    paddingVertical: 10,
  },
  chevron: { position: 'absolute', right: 15, top: 0, bottom: 0, justifyContent: 'center' },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  list: { backgroundColor: wizardColors.list, borderRadius: m.controlRadius, overflow: 'hidden' },
  row: {
    minHeight: m.optionRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: m.optionPadLeft,
    paddingRight: 16,
    paddingVertical: 9,
    borderWidth: m.hairline,
    borderColor: wizardColors.listRowBorder,
    backgroundColor: wizardColors.list,
  },
  rowLast: { borderBottomLeftRadius: 6, borderBottomRightRadius: 6 },
  rowSelected: { backgroundColor: wizardColors.listSelectedFill },
});
