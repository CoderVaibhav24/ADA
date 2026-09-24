/**
 * ConfirmDialog — asks once before something that cannot be undone from the phone
 * (log out, leave). A modal card with a title, plain-words body, the main action and a
 * way to stay. Drawn in the app's own style because the platform alert cannot carry an
 * icon and does nothing on the web preview.
 */

import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button, Icon, Text, type IconName } from '../atoms';
import { colors, control, radius, shell, space } from '../tokens';

export type ConfirmDialogProps = {
  visible: boolean;
  icon: IconName;
  title: string;
  body: string;
  /** Shown in a warning box under the body: what will not be sent. */
  warning?: string | null;
  confirmLabel: string;
  confirmIcon?: React.ReactNode;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  testID?: string;
};

// The scrim cancels; the hardware back cancels; only the main button confirms.
export function ConfirmDialog({
  visible,
  icon,
  title,
  body,
  warning,
  confirmLabel,
  confirmIcon,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
  testID,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel={cancelLabel} accessibilityRole="button" />
        <View testID={testID} style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
          <View style={styles.titleRow}>
            <Icon name={icon} size="lg" color="figAccent" />
            <Text variant="figHeaderTitle" color="white" style={styles.flex} accessibilityRole="header">
              {title}
            </Text>
          </View>
          <Text variant="figBodyLg" color="figChevron">
            {body}
          </Text>
          {warning ? (
            <View style={styles.warning}>
              <Icon name="warning" size="md" color="figPillInk" />
              <Text variant="figBody" color="white" style={styles.flex}>
                {warning}
              </Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Button label={confirmLabel} variant="figPrimary" onPress={onConfirm} loading={busy} leadingIcon={confirmIcon} />
            <Button label={cancelLabel} variant="figSecondary" onPress={onCancel} disabled={busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: shell.gutter, backgroundColor: colors.scrim },
  card: {
    gap: space[4],
    padding: space[5],
    borderRadius: radius.lg,
    borderWidth: control.hairline,
    borderColor: colors.figCardBorder,
    backgroundColor: colors.figPanel,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1 },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: control.hairline,
    borderColor: colors.figPillBorder,
    backgroundColor: colors.figPillFill,
  },
  actions: { gap: space[3] },
});
