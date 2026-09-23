/**
 * FormField — label, control, hint and error in one row. Every form row in the app uses
 * this, so a validation message never appears in two different places. ui-registry.md §3.
 */

import { View } from 'react-native';

import { Text } from '../atoms';
import { space, type LayoutStyle } from '../tokens';

export type FormFieldProps = {
  label: string;
  /** The control. Give it its own accessibilityLabel; React Native has no label-for. */
  children: React.ReactNode;
  required?: boolean;
  /** Says what to enter, not what went wrong. Hidden while an error is showing. */
  hint?: string;
  /** Specific, per code-standards.md §5: "Enter the measured area in square metres". */
  error?: string;
  style?: LayoutStyle;
};

// Error replaces hint so the row never grows mid-edit and pushes the keyboard target.
export function FormField({ label, children, required = false, hint, error, style }: FormFieldProps) {
  return (
    <View style={[{ gap: space[2] }, style]}>
      <Text variant="label" color="ink2">
        {required ? `${label} *` : label}
      </Text>
      {children}
      {error ? (
        <Text variant="caption" color="statusOverdue" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="ink3">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
