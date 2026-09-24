/**
 * OfflineBanner — the one line that says, in plain words, that the phone is offline
 * and how much work is still waiting to upload (ui-rules.md §2). It cannot be closed
 * while anything is waiting; it disappears on its own when there is nothing to say.
 * Pure: the numbers come from the caller (organisms/PendingBanner reads them).
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { useT, useTPlural } from '@/services/i18n';

import { Icon, Text, type IconName } from '../atoms';
import { colors, control, layout, radius, space, type ColorToken, type LayoutStyle } from '../tokens';

export type OfflineBannerProps = {
  offline: boolean;
  /** Items still owing the office bytes (photos, held arrivals). */
  waiting: number;
  /** Items that stopped retrying and need a tap. */
  failed: number;
  /** An upload is running right now. */
  sending?: boolean;
  /** Opens the pending-uploads list. Without it the banner is a plain notice. */
  onPress?: () => void;
  testID?: string;
  style?: LayoutStyle;
};

type Line = { icon: IconName; tone: ColorToken; text: string };

// Failure outranks offline, offline outranks waiting: the line that needs a tap comes first.
export function OfflineBanner({ offline, waiting, failed, sending = false, onPress, testID, style }: OfflineBannerProps) {
  const t = useT();
  const tp = useTPlural();
  const lines: Line[] = [];
  if (failed > 0) lines.push({ icon: 'alert', tone: 'figDanger', text: tp('shell.banner.failed', failed) });
  if (offline) lines.push({ icon: 'offline', tone: 'figPillInk', text: t('shell.banner.offline') });
  const stillWaiting = waiting - failed;
  if (stillWaiting > 0) {
    lines.push(
      sending
        ? { icon: 'sync', tone: 'figBeige', text: t('shell.banner.sending') }
        : { icon: 'upload', tone: 'figBeige', text: tp('shell.banner.waiting', stillWaiting) },
    );
  }
  if (lines.length === 0) return null;

  const body = (
    <View style={styles.lines}>
      {lines.map((line) => (
        <View key={line.text} style={styles.line}>
          <Icon name={line.icon} size="md" color={line.tone} />
          <Text variant="figBody" color="white" style={styles.text}>
            {line.text}
          </Text>
        </View>
      ))}
    </View>
  );
  const spoken = lines.map((line) => line.text).join('. ');

  if (!onPress || waiting === 0) {
    return (
      <View testID={testID} style={[styles.frame, style]} accessible accessibilityRole="alert" accessibilityLabel={spoken}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={t('shell.banner.hint')}
      style={({ pressed }) => [
        styles.frame,
        { backgroundColor: colors[pressed ? 'figControlPressed' : 'figPanelCard'] },
        style,
      ]}
    >
      {body}
      <Icon name="forward" size="md" color="figBeige" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: layout.touchMin,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: control.hairline,
    borderColor: colors.figMuted,
    backgroundColor: colors.figPanelCard,
  },
  lines: { flex: 1, gap: space[1] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  text: { flex: 1 },
});
