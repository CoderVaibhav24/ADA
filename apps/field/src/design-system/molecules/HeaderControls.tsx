/**
 * The header's round controls (TOPCONTROLL 163:1011 and its variants): the back button
 * (195:2349), the notification bell with its unread dot (204:4485) and the search pill
 * (163:1026). Each is drawn at its Figma size with its hit area raised to 48dp.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Glyph, Text } from '../atoms';
import { colors, control, layout, radius, shell, type LayoutStyle } from '../tokens';

// Grows a Figma-sized control's hit area to the 48dp minimum without moving a pixel.
function slopFor(size: number) {
  const extra = Math.max(0, (layout.touchMin - size) / 2);
  return { top: extra, bottom: extra, left: extra, right: extra };
}

export type HeaderBackButtonProps = {
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  style?: LayoutStyle;
};

// 40pt rounded square, `#635540`, chevron in `#CBD5E1`.
export function HeaderBackButton({ onPress, accessibilityLabel, testID, style }: HeaderBackButtonProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={slopFor(shell.back)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.back,
        { backgroundColor: colors[pressed ? 'figControlPressed' : 'figControl'] },
        style,
      ]}
    >
      <Glyph name="back" width={shell.backGlyph} color="figChevron" />
    </Pressable>
  );
}

export type HeaderBellButtonProps = {
  /** Unread items; the orange dot shows only above zero. */
  unread: number;
  /** Omit on the Notifications screen itself, where the bell is not a link (204:4317). */
  onPress?: () => void;
  accessibilityLabel: string;
  testID?: string;
  style?: LayoutStyle;
};

// The 45.78 circle with the bell and, when something is unread, the dot.
export function HeaderBellButton({ unread, onPress, accessibilityLabel, testID, style }: HeaderBellButtonProps) {
  const body = (pressed: boolean) => (
    <View style={[styles.bellCircle, { backgroundColor: colors[pressed ? 'figControlPressed' : 'figControl'] }]}>
      <View style={styles.bellGlyph}>
        <Glyph name="bell" width={shell.bellGlyphWidth} color="figBeige" />
      </View>
      {unread > 0 ? (
        <View style={styles.bellDot}>
          <Glyph name="dot" width={shell.bellDotWidth} color="figBadge" />
        </View>
      ) : null}
    </View>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.bellGroup, style]} accessible accessibilityLabel={accessibilityLabel}>
        {body(false)}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={slopFor(shell.control)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.bellGroup, style]}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

export type HeaderSearchPillProps = {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  style?: LayoutStyle;
};

// The pill is a button that opens the search screen; typing happens there.
export function HeaderSearchPill({ label, onPress, accessibilityLabel, testID, style }: HeaderSearchPillProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={slopFor(shell.control)}
      accessibilityRole="search"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: colors[pressed ? 'figControlPressed' : 'figControl'] },
        style,
      ]}
    >
      <Text variant="figSearch" color="white" numberOfLines={1} style={styles.pillText}>
        {label}
      </Text>
      <Glyph name="search" width={shell.searchIconWidth} color="figBeige" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    width: shell.back,
    height: shell.back,
    borderRadius: shell.backRadius,
    borderWidth: control.hairline,
    borderColor: colors.figBackBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellGroup: {
    width: shell.bellGroup,
    height: shell.control,
    alignItems: 'flex-end',
  },
  bellCircle: {
    width: shell.control,
    height: shell.control,
    borderRadius: radius.pill,
  },
  bellGlyph: { position: 'absolute', left: shell.bellGlyphOffset, top: shell.bellGlyphOffset },
  bellDot: { position: 'absolute', left: shell.bellDotLeft, top: shell.bellDotTop },
  pill: {
    flex: 1,
    maxWidth: shell.searchMaxWidth,
    height: shell.control,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: shell.searchTextLeft,
    paddingRight: shell.searchIconRight,
  },
  pillText: { flex: 1 },
});
