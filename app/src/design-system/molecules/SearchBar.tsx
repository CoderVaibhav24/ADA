/**
 * SearchBar — the Home and Complaints header search. ui-registry.md §3.
 */

import { Pressable, StyleSheet } from 'react-native';

import { Icon, Input } from '../atoms';
import { layout, space, type LayoutStyle } from '../tokens';

export type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  onClear?: () => void;
  autoFocus?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: LayoutStyle;
};

// Clear appears only when there is something to clear, at a full 44pt target.
export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  onSubmit,
  onClear,
  autoFocus = false,
  accessibilityLabel = 'Search',
  testID,
  style,
}: SearchBarProps) {
  return (
    <Input
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoCorrect={false}
      autoCapitalize="none"
      returnKeyType="search"
      accessibilityLabel={accessibilityLabel}
      leadingIcon={<Icon name="search" size="md" color="ink2" />}
      trailingIcon={
        value.length > 0 ? (
          <Pressable
            onPress={() => {
              onChangeText('');
              onClear?.();
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
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
  clear: {
    width: layout.touchMin,
    height: layout.touchMin,
    marginRight: -space[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
