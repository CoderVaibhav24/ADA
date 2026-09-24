/**
 * SearchBar — the Home and Complaints header search. ui-registry.md §3.
 */

import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useScriptOf, useT } from '@/services/i18n';

import { Glyph, Icon, Input } from '../atoms';
import { colors, layout, radius, shell, space, textStyle, type LayoutStyle } from '../tokens';

export type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  onClear?: () => void;
  autoFocus?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  /** `pill` is the header search pill (163:1026) as a live field, for the Search screen. */
  appearance?: 'default' | 'pill';
  style?: LayoutStyle;
};

// Clear appears only when there is something to clear, at a full 44pt target.
export function SearchBar({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  onClear,
  autoFocus = false,
  accessibilityLabel,
  testID,
  appearance = 'default',
  style,
}: SearchBarProps) {
  const t = useT();
  const script = useScriptOf(value === '' ? (placeholder ?? t('common.search')) : value);
  if (appearance === 'pill') {
    return (
      <View style={[styles.pill, style]}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          placeholder={placeholder ?? t('common.search')}
          placeholderTextColor={colors.figBeige}
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={accessibilityLabel ?? t('common.search')}
          selectionColor={colors.figAccent}
          style={[textStyle('figBodyLg', 'white', script), styles.pillInput]}
        />
        {value.length > 0 ? (
          <Pressable
            onPress={() => {
              onChangeText('');
              onClear?.();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('common.clearSearch')}
            style={styles.clear}
          >
            <Icon name="close" size="md" color="figBeige" />
          </Pressable>
        ) : (
          <Glyph name="search" width={shell.searchIconWidth} color="figBeige" />
        )}
      </View>
    );
  }
  return (
    <Input
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      placeholder={placeholder ?? t('common.search')}
      autoFocus={autoFocus}
      autoCorrect={false}
      autoCapitalize="none"
      returnKeyType="search"
      accessibilityLabel={accessibilityLabel ?? t('common.search')}
      leadingIcon={<Icon name="search" size="md" color="ink2" />}
      trailingIcon={
        value.length > 0 ? (
          <Pressable
            onPress={() => {
              onChangeText('');
              onClear?.();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('common.clearSearch')}
            style={styles.clear}
          >
            <Icon name="close" size="md" color="ink2" />
          </Pressable>
        ) : undefined
      }
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.touchMin,
    paddingLeft: shell.searchTextLeft,
    paddingRight: shell.searchIconRight,
    borderRadius: radius.pill,
    backgroundColor: colors.figControl,
  },
  pillInput: { flex: 1, paddingVertical: space[2] },
  clear: {
    width: layout.touchMin,
    height: layout.touchMin,
    marginRight: -space[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
