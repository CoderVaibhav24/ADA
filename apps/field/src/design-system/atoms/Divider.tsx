/** Divider — the hairline between rows inside a card. ui-registry.md §3. */

import { StyleSheet, View } from 'react-native';

import {
  colors,
  control,
  space,
  type ColorToken,
  type LayoutStyle,
  type SpaceToken,
} from '../tokens';

export type DividerProps = {
  orientation?: 'horizontal' | 'vertical';
  tone?: ColorToken;
  /** Inset from the leading edge, so a divider lines up with row text, not the card edge. */
  inset?: SpaceToken;
  style?: LayoutStyle;
};

// A one-pixel rule that never participates in accessibility.
export function Divider({ orientation = 'horizontal', tone = 'line2', inset = 0, style }: DividerProps) {
  const vertical = orientation === 'vertical';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        vertical ? styles.vertical : styles.horizontal,
        { backgroundColor: colors[tone] },
        vertical ? { marginVertical: space[inset] } : { marginLeft: space[inset] },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  horizontal: { height: control.hairline, alignSelf: 'stretch' },
  vertical: { width: control.hairline, alignSelf: 'stretch' },
});
