/**
 * SectionCard — a titled card holding ListRows or a block on a detail screen.
 * The dark card treatment from ui-tokens.md §1 (`surface1`).
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '../atoms';
import { colors, radius, space, type LayoutStyle } from '../tokens';

export type SectionCardProps = {
  title?: string;
  /** Right of the title: a chip or a count. */
  accessory?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
  style?: LayoutStyle;
};

// Title row, then the body; the card never scrolls on its own.
export function SectionCard({ title, accessory, children, testID, style }: SectionCardProps) {
  return (
    <View testID={testID} style={[styles.card, style]}>
      {title || accessory ? (
        <View style={styles.titleRow}>
          {title ? (
            <Text variant="label" color="ink2" accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
          ) : null}
          {accessory}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  title: { flex: 1 },
});
