/**
 * StatStrip — the three Home counts (`158:3829`). Each count is a server total or a
 * stated state: loading, failed with the server's message, or in progress when no
 * filter can produce it honestly. A count is never estimated.
 */

import { StyleSheet, View } from 'react-native';

import { Icon, Skeleton, Text, type IconName } from '../atoms';
import { InProgressBlock, StatCard } from '../molecules';
import { colors, layout, radius, space, type ColorToken, type LayoutStyle } from '../tokens';

export type StatState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'in_progress' };

export type StatItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  readonly tone?: ColorToken;
  readonly state: StatState;
  readonly onPress?: () => void;
  readonly accessibilityHint?: string;
};

export type StatStripProps = {
  items: readonly StatItem[];
  style?: LayoutStyle;
};

// One slot per count; the slot's shape does not change between states, so nothing jumps.
function StatSlot({ item }: { item: StatItem }) {
  const { state } = item;
  if (state.kind === 'in_progress') {
    return <InProgressBlock title={item.label} compact testID={`stat-${item.key}`} />;
  }
  if (state.kind === 'loading') {
    return (
      <View style={styles.slot} accessible accessibilityLabel={`${item.label}: loading`}>
        <Icon name={item.icon} size="md" color="ink3" />
        <Skeleton height={layout.touchMin / 2} width="60%" />
        <Text variant="label" color="ink2" numberOfLines={2}>
          {item.label}
        </Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.slot} accessible accessibilityRole="alert">
        <Icon name="alert" size="md" color="statusOverdue" />
        <Text variant="label" color="ink2" numberOfLines={2}>
          {item.label}
        </Text>
        <Text variant="caption" color="ink3" numberOfLines={3}>
          {state.message}
        </Text>
      </View>
    );
  }
  return (
    <StatCard
      testID={`stat-${item.key}`}
      label={item.label}
      value={state.value}
      icon={item.icon}
      tone={item.tone}
      onPress={item.onPress}
      accessibilityHint={item.accessibilityHint}
    />
  );
}

// Lays the counts out in one row; each takes an equal share.
export function StatStrip({ items, style }: StatStripProps) {
  return (
    <View style={[styles.row, style]}>
      {items.map((item) => (
        <StatSlot key={item.key} item={item} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[3], alignItems: 'stretch' },
  slot: {
    flex: 1,
    minHeight: layout.touchMin,
    gap: space[1],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
  },
});
