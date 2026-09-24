/**
 * StatStrip — the three Home counts (170:3829). Each count is a server total or a
 * stated state: loading, failed, or not ready yet when no filter can produce it
 * honestly. A count is never estimated.
 */

import { StyleSheet, View } from 'react-native';

import { useT } from '@/services/i18n';

import { Icon, Skeleton, Text, type IconName } from '../atoms';
import { StatCard } from '../molecules';
import { colors, control, figCard, radius, space, type ColorToken, type LayoutStyle } from '../tokens';

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

// A tile-shaped frame for the non-number states, so nothing jumps when the number lands.
function Tile({ label, spoken, top, alert = false }: { label: string; spoken: string; top: React.ReactNode; alert?: boolean }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={spoken} accessibilityRole={alert ? 'alert' : undefined}>
      {top}
      <Text variant="figMetricLabel" color="figBeige" align="center" numberOfLines={2} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

// One slot per count.
function StatSlot({ item }: { item: StatItem }) {
  const t = useT();
  const { state } = item;
  if (state.kind === 'in_progress') {
    const soon = t('shell.home.overdueSoon');
    return (
      <Tile
        label={item.label}
        spoken={`${item.label}: ${soon}`}
        top={
          <View style={styles.soon}>
            <Icon name="clock" size="sm" color={item.tone ?? 'figAccent'} />
            <Text variant="figTime" color="figMuted" align="center" numberOfLines={2}>
              {soon}
            </Text>
          </View>
        }
      />
    );
  }
  if (state.kind === 'loading') {
    return (
      <Tile
        label={item.label}
        spoken={t('shell.home.countLoading', { label: item.label })}
        top={<Skeleton height={figCard.metricSkeleton} width="40%" tone="figControl" />}
      />
    );
  }
  if (state.kind === 'error') {
    return (
      <Tile
        alert
        label={item.label}
        spoken={`${t('shell.home.countFailed', { label: item.label })}. ${state.message}`}
        top={<Icon name="alert" size="md" color="figDanger" />}
      />
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

// The three counts in one row, each an equal share, over the row's hairline.
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
  row: {
    flexDirection: 'row',
    gap: figCard.metricGap,
    alignItems: 'stretch',
    minHeight: figCard.metricRowHeight,
    paddingTop: space[1],
    paddingBottom: figCard.metricRowPadBottom,
    borderBottomWidth: control.hairline,
    borderBottomColor: colors.figRule,
  },
  tile: {
    flex: 1,
    minHeight: figCard.metricTileHeight,
    padding: figCard.metricPad,
    borderRadius: radius.md,
    borderWidth: control.hairline,
    borderColor: colors.figTileBorder,
    backgroundColor: colors.figTile,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
  soon: { alignItems: 'center', minHeight: figCard.metricSkeleton },
  label: { paddingTop: figCard.labelGap },
});
