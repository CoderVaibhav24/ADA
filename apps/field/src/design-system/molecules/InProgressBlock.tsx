/**
 * InProgressBlock — a block inside a working screen whose data has no API yet.
 * It names the block and says the feature is in progress; it never shows a sample value.
 * The full-screen form is templates/InProgressScreen.
 */

import { StyleSheet, View } from 'react-native';

import { useT } from '@/services/i18n';

import { Icon, Text } from '../atoms';
import { colors, control, radius, space, type LayoutStyle } from '../tokens';

export type InProgressBlockProps = {
  /** What the block would show, as the designs name it. */
  title: string;
  /** Tighter padding for a slot inside a row, such as one of the Home counts. */
  compact?: boolean;
  testID?: string;
  style?: LayoutStyle;
};

// A dashed, muted panel so it reads as absent content rather than an empty result.
export function InProgressBlock({ title, compact = false, testID, style }: InProgressBlockProps) {
  const t = useT();
  const line = t('common.inProgress');
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${title}. ${line}`}
      style={[styles.frame, compact ? styles.compact : styles.regular, style]}
    >
      <View style={styles.heading}>
        <Icon name="clock" size="sm" color="ink3" />
        <Text variant={compact ? 'label' : 'subheading'} color="ink2" numberOfLines={2}>
          {title}
        </Text>
      </View>
      <Text variant="caption" color="ink3">
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    gap: space[1],
    borderRadius: radius.md,
    borderWidth: control.borderWidth,
    borderStyle: 'dashed',
    borderColor: colors.line1,
    backgroundColor: colors.surface1,
  },
  regular: { padding: space[4] },
  compact: { padding: space[3], flex: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
