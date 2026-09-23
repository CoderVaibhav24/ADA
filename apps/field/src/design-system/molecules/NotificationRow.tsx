/**
 * NotificationRow — typed icon, body with the case reference emphasised, relative time.
 * The payload is a routing hint: the row renders what the caller fetched, never a push
 * payload treated as case data (code-standards.md rule 10).
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Icon, Text, type IconName } from '../atoms';
import {
  colors,
  layout,
  radius,
  space,
  type ColorToken,
  type LayoutStyle,
} from '../tokens';

export type NotificationKind =
  | 'assignment'
  | 'schedule'
  | 'reminder'
  | 'overdue'
  | 'approved'
  | 'resurvey'
  | 'sync'
  | 'general';

const kindIcons: Record<NotificationKind, IconName> = {
  assignment: 'complaints',
  schedule: 'calendar',
  reminder: 'clock',
  overdue: 'warning',
  approved: 'success',
  resurvey: 'edit',
  sync: 'sync',
  general: 'bell',
};

const kindTones: Record<NotificationKind, ColorToken> = {
  assignment: 'brand',
  schedule: 'statusScheduled',
  reminder: 'statusNew',
  overdue: 'statusOverdue',
  approved: 'statusDone',
  resurvey: 'priorityMedium',
  sync: 'syncPending',
  general: 'ink2',
};

export type NotificationRowProps = {
  kind: NotificationKind;
  /** A heading above the body, when the sender supplied both. */
  title?: string;
  body: string;
  /** Rendered monospace and first, because that is what gets read aloud on a call. */
  caseRef?: string;
  /** Preformatted relative time: "18 min ago". Formatting belongs at the render edge. */
  timeLabel: string;
  unread?: boolean;
  onPress?: () => void;
  testID?: string;
  style?: LayoutStyle;
};

// Tapping refetches; the row itself only presents what it was given.
export function NotificationRow({
  kind,
  title,
  body,
  caseRef,
  timeLabel,
  unread = false,
  onPress,
  testID,
  style,
}: NotificationRowProps) {
  const spoken = `${unread ? 'Unread. ' : ''}${caseRef ? `${caseRef}. ` : ''}${title ? `${title}. ` : ''}${body}. ${timeLabel}`;
  const content = (
    <View style={styles.row}>
      <View style={[styles.iconWell, { backgroundColor: colors.surface2 }]}>
        <Icon name={kindIcons[kind]} size="md" color={kindTones[kind]} />
      </View>
      <View style={styles.body}>
        {title ? (
          <Text variant={unread ? 'subheading' : 'label'} color="ink0">
            {title}
          </Text>
        ) : null}
        <Text variant="body" color={unread ? 'ink0' : 'ink1'}>
          {caseRef ? (
            <Text variant="mono" color="brand" selectable>
              {`${caseRef}  `}
            </Text>
          ) : null}
          {body}
        </Text>
        <Text variant="caption" color="ink3">
          {timeLabel}
        </Text>
      </View>
      {unread ? <Badge accessibilityLabel="Unread" /> : null}
    </View>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={spoken} style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={caseRef ? 'Opens the case and refreshes it' : 'Marks it read'}
      style={({ pressed }) => [
        styles.pressable,
        { backgroundColor: colors[pressed ? 'surface2' : 'transparent'] },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { borderRadius: radius.md },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    minHeight: layout.touchMin,
    padding: space[3],
  },
  iconWell: {
    width: layout.touchMin,
    height: layout.touchMin,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: space[1] },
});
