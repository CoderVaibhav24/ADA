import { Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Chip,
  Divider,
  Icon,
  InProgressBlock,
  ListRow,
  NotificationRow,
  PriorityChip,
  ProgressBar,
  ScreenHeader,
  SectionCard,
  StatCard,
  StateMessage,
  Text,
  colors,
  layout,
  radius,
  space,
  type ButtonSize,
  type ButtonVariant,
  type CasePriority,
  type ChipAppearance,
  type ChipSize,
  type NotificationKind,
  type StateMessageTone,
} from '@/design-system';

import { MAX_LIST_ITEMS, contract } from '../contract';
import type { Scope } from '../template';
import type { SduiNode } from '../types';
import {
  bool,
  colorToken,
  iconName,
  iconSizeToken,
  int,
  num,
  oneOf,
  spaceToken,
  str,
  text,
  textVariant,
} from './adapt';

/*
 * The component registry: one entry per `type` in contract.json, each adapting
 * served props onto one design-system component. The `satisfies` below makes a
 * type added to the contract without an entry here a compile error. A `type` the
 * binary does not know never reaches this table — the renderer drops it.
 */

export type RenderArgs = {
  /** Props with templates already resolved. Still untyped: each entry adapts its own. */
  readonly props: Readonly<Record<string, unknown>>;
  /** The node's children, already rendered. */
  readonly children: ReactNode;
  readonly node: SduiNode;
  readonly scope: Scope;
  /** Present only when the node declares an action. */
  readonly onPress?: () => void;
  readonly testID?: string;
  /** Renders another node, for slots such as a list's item template. */
  readonly renderNode: (node: unknown, scope: Scope, key: string) => ReactNode;
};

export type ComponentEntry = (args: RenderArgs) => ReactNode;

export type ComponentType = keyof typeof contract.components;

const BUTTON_VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'destructive'];
const BUTTON_SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];
const CHIP_APPEARANCES: readonly ChipAppearance[] = ['soft', 'solid', 'outline'];
const CHIP_SIZES: readonly ChipSize[] = ['sm', 'md'];
const PRIORITIES: readonly CasePriority[] = ['high', 'medium', 'low'];
const STATE_TONES: readonly StateMessageTone[] = ['empty', 'error', 'offline'];
const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'assignment',
  'schedule',
  'reminder',
  'overdue',
  'approved',
  'resurvey',
  'sync',
];
const ALIGNS = ['auto', 'left', 'right', 'center'] as const;

// A count that has not resolved reads as a dash, never as a zero it did not measure.
function statValue(value: unknown): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const shown = text(value);
  return shown === '' ? '–' : shown;
}

const list: ComponentEntry = ({ props, node, scope, renderNode }) => {
  const items = Array.isArray(scope.data) ? scope.data : [];
  const limit = Math.min(int(props.limit, 1, MAX_LIST_ITEMS) ?? MAX_LIST_ITEMS, MAX_LIST_ITEMS);
  const shown = items.slice(0, limit);
  if (shown.length === 0) return node.empty === undefined ? null : renderNode(node.empty, scope, 'empty');
  const divided = bool(props.divided) === true;
  return (
    <View style={divided ? undefined : styles.list}>
      {shown.map((item, index) => (
        <Fragment key={index}>
          {divided && index > 0 ? <Divider /> : null}
          {renderNode(node.item, { ...scope, item, index }, `item-${index}`)}
        </Fragment>
      ))}
    </View>
  );
};

export const registry = {
  screen_header: ({ props, children }) => {
    const subtitle = str(props.subtitle);
    return (
      <ScreenHeader
        title={text(props.title)}
        subtitle={
          subtitle ? (
            <Text variant="caption" color="ink2">
              {subtitle}
            </Text>
          ) : undefined
        }
        actions={children}
      />
    );
  },

  icon_button: ({ props, onPress, testID }) => {
    const name = iconName(props.icon);
    if (name === undefined || onPress === undefined) return null;
    const badge = num(props.badge);
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={text(props.label)}
        style={({ pressed }) => [
          styles.iconButton,
          { backgroundColor: colors[pressed ? 'surface2' : 'transparent'] },
        ]}
      >
        <Icon name={name} size="lg" color="ink0" />
        {badge !== undefined && badge > 0 ? <Badge count={badge} style={styles.badge} /> : null}
      </Pressable>
    );
  },

  stat_strip: ({ children }) => <View style={styles.strip}>{children}</View>,

  stat_card: ({ props, onPress, testID }) => (
    <StatCard
      label={text(props.label)}
      value={statValue(props.value)}
      icon={iconName(props.icon)}
      tone={colorToken(props.tone)}
      onPress={onPress}
      testID={testID}
    />
  ),

  section: ({ props, children }) => (
    <View style={styles.section}>
      <Text variant="subheading" color="ink0" accessibilityRole="header">
        {text(props.title)}
      </Text>
      {children}
    </View>
  ),

  card: ({ props, children, testID }) => (
    <SectionCard title={str(props.title)} testID={testID}>
      {children}
    </SectionCard>
  ),

  stack: ({ props, children }) => (
    <View style={{ gap: space[spaceToken(props.gap) ?? 3] }}>{children}</View>
  ),

  row: ({ props, children }) => (
    <View style={[styles.row, { gap: space[spaceToken(props.gap) ?? 2] }]}>{children}</View>
  ),

  list,

  list_row: ({ props, onPress, testID }) => (
    <ListRow
      label={text(props.label)}
      value={str(props.value)}
      monospaceValue={bool(props.monospace)}
      onPress={onPress}
      testID={testID}
    />
  ),

  notification_row: ({ props, onPress, testID }) => {
    const kind = oneOf(props.kind, NOTIFICATION_KINDS);
    if (kind === undefined) return null;
    return (
      <NotificationRow
        kind={kind}
        body={text(props.body)}
        caseRef={str(props.caseRef) || undefined}
        timeLabel={text(props.timeLabel)}
        unread={bool(props.unread)}
        onPress={onPress}
        testID={testID}
      />
    );
  },

  text: ({ props, testID }) => {
    const content = text(props.text);
    if (content === '') return null;
    return (
      <Text
        testID={testID}
        variant={textVariant(props.variant)}
        color={colorToken(props.color)}
        align={oneOf(props.align, ALIGNS)}
        numberOfLines={int(props.lines, 1, 10)}
      >
        {content}
      </Text>
    );
  },

  button: ({ props, onPress, testID }) => {
    if (onPress === undefined) return null;
    const leading = iconName(props.icon);
    const variant = oneOf(props.variant, BUTTON_VARIANTS);
    return (
      <Button
        label={text(props.label)}
        onPress={onPress}
        variant={variant}
        size={oneOf(props.size, BUTTON_SIZES)}
        fullWidth={bool(props.fullWidth)}
        leadingIcon={
          leading ? (
            <Icon name={leading} size="sm" color={variant === 'primary' || variant === undefined ? 'inkOnMuted' : 'ink0'} />
          ) : undefined
        }
        testID={testID}
      />
    );
  },

  chip: ({ props, testID }) => (
    <Chip
      label={text(props.label)}
      tone={colorToken(props.tone)}
      appearance={oneOf(props.appearance, CHIP_APPEARANCES)}
      size={oneOf(props.size, CHIP_SIZES)}
      dot={bool(props.dot)}
      testID={testID}
    />
  ),

  priority_chip: ({ props, testID }) => {
    const priority = oneOf(props.priority, PRIORITIES);
    return priority === undefined ? null : <PriorityChip priority={priority} testID={testID} />;
  },

  icon: ({ props }) => {
    const name = iconName(props.name);
    if (name === undefined) return null;
    return (
      <Icon
        name={name}
        size={iconSizeToken(props.size)}
        color={colorToken(props.color)}
        accessibilityLabel={str(props.label)}
      />
    );
  },

  in_progress: ({ props, testID }) => (
    <InProgressBlock title={text(props.title)} compact={bool(props.compact)} testID={testID} />
  ),

  state_message: ({ props, testID }) => {
    const tone = oneOf(props.tone, STATE_TONES);
    if (tone === undefined) return null;
    return (
      <StateMessage tone={tone} title={text(props.title)} message={str(props.message)} testID={testID} />
    );
  },

  progress_bar: ({ props }) => {
    const value = num(props.value);
    if (value === undefined) return null;
    return (
      <View style={styles.row}>
        <ProgressBar value={value} accessibilityLabel={str(props.label)} />
      </View>
    );
  },

  spacer: ({ props }) => <View style={{ height: space[spaceToken(props.size) ?? 4] }} />,

  divider: () => <Divider />,
} satisfies Record<ComponentType, ComponentEntry>;

// The entry for a type, or undefined for one this binary does not know.
export function componentFor(type: string): ComponentEntry | undefined {
  return Object.prototype.hasOwnProperty.call(registry, type)
    ? (registry as Record<string, ComponentEntry>)[type]
    : undefined;
}

const styles = StyleSheet.create({
  iconButton: {
    width: layout.touchMin,
    height: layout.touchMin,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', top: space[1], right: space[1] },
  strip: { flexDirection: 'row', gap: space[3] },
  section: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center' },
  list: { gap: space[3] },
});
