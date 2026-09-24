/**
 * StateMessage — the empty and error states of a list or a block (ui-rules.md §1.5:
 * every state is designed). The message is the caller's; for an error it is the
 * server's own text, never a generic string.
 */

import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text, type IconName } from '../atoms';
import { space, type LayoutStyle } from '../tokens';

export type StateMessageTone = 'empty' | 'error' | 'offline';

export type StateMessageProps = {
  tone: StateMessageTone;
  title: string;
  message?: string;
  /** Shown small and selectable: the id in the server log line, for a support call. */
  reference?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  style?: LayoutStyle;
};

const glyph: Record<StateMessageTone, IconName> = {
  empty: 'info',
  error: 'alert',
  offline: 'offline',
};

// Centred icon, title, message and one optional action.
export function StateMessage({
  tone,
  title,
  message,
  reference,
  actionLabel,
  onAction,
  testID,
  style,
}: StateMessageProps) {
  return (
    <View
      testID={testID}
      style={[styles.frame, style]}
      accessibilityRole={tone === 'empty' ? undefined : 'alert'}
    >
      <Icon name={glyph[tone]} size="xl" color={tone === 'error' ? 'figDanger' : 'figBeige'} />
      <Text variant="figCardTitle" color="white" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="figBody" color="figChevron" align="center">
          {message}
        </Text>
      ) : null}
      {reference ? (
        <Text variant="mono" color="figMuted" align="center" selectable>
          {reference}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          variant="figSecondary"
          fullWidth={false}
          style={styles.action}
          leadingIcon={<Icon name={tone === 'empty' ? 'forward' : 'sync'} size="sm" color="white" />}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[6],
  },
  action: { alignSelf: 'center' },
});
