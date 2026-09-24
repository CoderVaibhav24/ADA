/**
 * NotificationRow — typed icon box, the message with the case reference in bold, and
 * the time (173:4672 on Home, 204:4437 on Notifications). The payload is a routing
 * hint: the row renders what the caller fetched, never a push payload treated as case
 * data (code-standards.md rule 10).
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { useT } from '@/services/i18n';

import { Glyph, Text, type GlyphName } from '../atoms';
import { colors, control, elevation, figCard, pressedOpacity, radius, space, type ColorToken, type LayoutStyle } from '../tokens';

export type NotificationKind =
  | 'assignment'
  | 'schedule'
  | 'reminder'
  | 'overdue'
  | 'approved'
  | 'resurvey'
  | 'sync'
  | 'general';

type Look = 'alert' | 'reminder' | 'accepted';

// The three boxes the frames draw; every kind lands on one of them.
const lookOf: Record<NotificationKind, Look> = {
  assignment: 'alert',
  overdue: 'alert',
  resurvey: 'alert',
  schedule: 'reminder',
  reminder: 'reminder',
  sync: 'reminder',
  general: 'reminder',
  approved: 'accepted',
};

const looks: Record<Look, { glyph: GlyphName; fill: ColorToken; border: ColorToken; ink: ColorToken }> = {
  alert: { glyph: 'alert', fill: 'figAlertFill', border: 'figAlertBorder', ink: 'figAlertInk' },
  reminder: { glyph: 'reminder', fill: 'figReminderFill', border: 'figReminderBorder', ink: 'figReminderInk' },
  accepted: { glyph: 'accepted', fill: 'figAcceptFill', border: 'figAcceptBorder', ink: 'figAcceptInk' },
};

export type NotificationRowProps = {
  kind: NotificationKind;
  /** A heading above the body, when the sender supplied both. */
  title?: string;
  body: string;
  /** Shown in bold inside the message, or before it when the message does not name it. */
  caseRef?: string;
  /** Preformatted relative time: "18 min ago". Formatting belongs at the render edge. */
  timeLabel: string;
  unread?: boolean;
  onPress?: () => void;
  /** `grouped`: a row inside the Home card (173:4670). `card`: its own card (204:4437). */
  appearance?: 'grouped' | 'card';
  /** Grouped rows: the hairline under every row but the last. */
  showDivider?: boolean;
  testID?: string;
  style?: LayoutStyle;
};

// Splits the message around the case reference so it can be set in bold where it stands.
function parts(body: string, caseRef: string | undefined): { before: string; bold: string | null; after: string } {
  if (!caseRef) return { before: body, bold: null, after: '' };
  const at = body.indexOf(caseRef);
  if (at < 0) return { before: '', bold: caseRef, after: ` · ${body}` };
  return { before: body.slice(0, at), bold: caseRef, after: body.slice(at + caseRef.length) };
}

// Tapping opens the case, which refetches; the row itself only presents what it was given.
export function NotificationRow({
  kind,
  title,
  body,
  caseRef,
  timeLabel,
  unread = false,
  onPress,
  appearance = 'grouped',
  showDivider = false,
  testID,
  style,
}: NotificationRowProps) {
  const t = useT();
  const look = looks[lookOf[kind]];
  const card = appearance === 'card';
  const ink: ColorToken = card ? 'figNoteInk' : 'figChevron';
  const strong: ColorToken = card ? 'figNoteStrong' : 'white';
  const text = parts(body, caseRef);
  const newWord = t('shell.notifications.new');
  const time = unread ? `${newWord} · ${timeLabel}` : timeLabel;
  const spoken = `${unread ? `${t('notification.unreadPrefix')} ` : ''}${title ? `${title}. ` : ''}${caseRef && text.before === '' ? `${caseRef}. ` : ''}${body}. ${timeLabel}`;

  const content = (
    <View style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: colors[look.fill], borderColor: colors[look.border] }]}>
        <Glyph name={look.glyph} color={look.ink} />
      </View>
      <View style={styles.body}>
        {title ? (
          <Text variant="figBodyStrong" color={strong}>
            {title}
          </Text>
        ) : null}
        <Text variant="figBody" color={ink}>
          {text.before}
          {text.bold ? (
            <Text variant="figBodyStrong" color={strong} selectable>
              {text.bold}
            </Text>
          ) : null}
          {text.after}
        </Text>
        <View style={styles.timeRow}>
          {unread ? <View style={styles.unreadDot} /> : null}
          <Text variant="figTime" color={card ? 'figNoteInk' : 'figMuted'}>
            {time}
          </Text>
        </View>
      </View>
    </View>
  );

  const frame = [card ? styles.card : styles.grouped, showDivider && !card ? styles.divider : null, style];
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={spoken} style={frame}>
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
      accessibilityHint={t(caseRef ? 'notification.hint.openCase' : 'notification.hint.markRead')}
      style={({ pressed }) => [...frame, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grouped: { minHeight: figCard.noteIconBox },
  divider: {
    paddingBottom: figCard.rowPadBottom,
    borderBottomWidth: control.hairline,
    borderBottomColor: colors.figDivider,
  },
  card: {
    padding: figCard.panelPad,
    borderRadius: radius.lg,
    borderWidth: control.hairline,
    borderColor: colors.figMuted,
    backgroundColor: colors.figNoteCard,
    ...elevation.figCard,
  },
  pressed: { opacity: pressedOpacity },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: figCard.panelGap },
  iconBox: {
    width: figCard.noteIconBox,
    height: figCard.noteIconBox,
    marginTop: figCard.noteIconTop,
    borderRadius: radius.md,
    borderWidth: control.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: figCard.noteTextGap },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  unreadDot: {
    width: space[2],
    height: space[2],
    borderRadius: radius.pill,
    backgroundColor: colors.figBadge,
  },
});
