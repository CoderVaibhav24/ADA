/**
 * StepperBar — the four-segment wizard progress. Progress is always visible: segments,
 * the current step's name, and "STEP n OF 4" (ui-rules.md §5).
 */

import { StyleSheet, View } from 'react-native';

import { useT } from '@/services/i18n';

import { ProgressBar, Text } from '../atoms';
import { space, type LayoutStyle } from '../tokens';

export type StepperBarProps = {
  /** Step names in order. The length is the denominator; nothing hard-codes four. */
  steps: readonly string[];
  /** 1-based, so it matches the "STEP 1 OF 4" the surveyor reads. */
  current: number;
  style?: LayoutStyle;
};

// A segment is complete, current or pending; the current one fills to show it is in play.
export function StepperBar({ steps, current, style }: StepperBarProps) {
  const t = useT();
  const total = steps.length;
  const index = Math.min(Math.max(current, 1), total);
  const name = steps[index - 1] ?? '';
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('stepper.a11y', { current: index, total, name })}
      accessibilityValue={{ min: 1, max: total, now: index }}
      style={[{ gap: space[2] }, style]}
    >
      <View style={styles.segments}>
        {steps.map((step, position) => (
          <ProgressBar
            key={`${position}-${step}`}
            value={position + 1 <= index ? 1 : 0}
            tone={position + 1 <= index ? 'brand' : 'surface2'}
          />
        ))}
      </View>
      <View style={styles.caption}>
        <Text variant="label" color="brand">{t('stepper.progress', { current: index, total })}</Text>
        <Text variant="subheading" color="ink0" numberOfLines={1} style={styles.name}>
          {name}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', gap: space[1] },
  caption: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  name: { flexShrink: 1 },
});
