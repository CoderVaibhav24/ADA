/**
 * ResultCard — one tappable line of work on the screens the frames do not draw (Search,
 * Pending uploads), in the Home card language (173:4645): an icon box, the case
 * reference in bold, plain-words lines under it and an optional status with its icon.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '../atoms';
import { colors, control, elevation, figCard, layout, radius, space, type ColorToken, type LayoutStyle } from '../tokens';

export type ResultCardProps = {
  icon: IconName;
  iconTone?: ColorToken;
  title: string;
  lines?: readonly (string | null | undefined)[];
  /** A state line with its own icon and colour, e.g. "Could not send. Tap to try again." */
  status?: { readonly icon: IconName; readonly tone: ColorToken; readonly text: string } | null;
  onPress?: () => void;
  accessibilityHint?: string;
  testID?: string;
  style?: LayoutStyle;
};

// A 48dp-plus card; the whole card is the target.
export function ResultCard({ icon, iconTone = 'figBeige', title, lines = [], status, onPress, accessibilityHint, testID, style }: ResultCardProps) {
  const shown = lines.filter((line): line is string => typeof line === 'string' && line !== '');
  const spoken = [title, ...shown, status?.text].filter(Boolean).join('. ');
  const body = (
    <>
      <View style={styles.iconBox}>
        <Icon name={icon} size="md" color={iconTone} />
      </View>
      <View style={styles.text}>
        <Text variant="figBodyStrong" color="white" selectable>
          {title}
        </Text>
        {shown.map((line) => (
          <Text key={line} variant="figBody" color="figChevron">
            {line}
          </Text>
        ))}
        {status ? (
          <View style={styles.status}>
            <Icon name={status.icon} size="sm" color={status.tone} />
            <Text variant="figMeta" color={status.tone} style={styles.flex}>
              {status.text}
            </Text>
          </View>
        ) : null}
      </View>
      {onPress ? <Icon name="forward" size="md" color="figBeige" /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.card, style]} accessible accessibilityLabel={spoken}>
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
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.card, { backgroundColor: colors[pressed ? 'figControl' : 'figCard'] }, style]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: figCard.panelGap,
    minHeight: layout.touchMin,
    padding: figCard.panelPad,
    borderRadius: figCard.cardRadius,
    borderWidth: control.hairline,
    borderColor: colors.figCardBorder,
    backgroundColor: colors.figCard,
    ...elevation.figCard,
  },
  iconBox: {
    width: figCard.noteIconBox,
    height: figCard.noteIconBox,
    borderRadius: radius.md,
    borderWidth: control.hairline,
    borderColor: colors.figReminderBorder,
    backgroundColor: colors.figReminderFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: figCard.noteTextGap },
  status: { flexDirection: 'row', alignItems: 'center', gap: space[1], paddingTop: space[1] },
  flex: { flex: 1 },
});
