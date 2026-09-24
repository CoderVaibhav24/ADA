import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, Text, colors, fontScaleMax, radius, space } from '@/design-system';
import { useT } from '@/services/i18n';

type Props = {
  visible: boolean;
  /** Null when no helpline is configured: the sheet then says to ask the office. */
  phone: string | null;
  onCall: () => void;
  onClose: () => void;
};

// Forgot password: only the office can reset it, so the one action is a big call button.
export function ForgotPasswordSheet({ visible, phone, onCall, onClose }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space[6] }]} accessibilityViewIsModal>
          <View style={styles.heading}>
            <Icon name="phone" size="lg" color="brand" />
            <Text variant="heading" color="ink0" accessibilityRole="header" maxFontSizeMultiplier={fontScaleMax}>
              {t('login.forgotSheet.title')}
            </Text>
          </View>
          <Text variant="subheading" color="ink1" maxFontSizeMultiplier={fontScaleMax}>
            {phone === null ? t('login.forgotSheet.noNumber') : t('login.forgotSheet.body')}
          </Text>
          {phone === null ? null : (
            <Button
              label={t('login.forgotSheet.call', { number: phone })}
              onPress={onCall}
              size="lg"
              leadingIcon={<Icon name="phone" size="md" color="inkOnMuted" />}
            />
          )}
          <Button
            label={t('common.close')}
            onPress={onClose}
            variant="secondary"
            size="lg"
            leadingIcon={<Icon name="close" size="md" color="ink0" />}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    gap: space[4],
    paddingTop: space[6],
    paddingHorizontal: space[4],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surface1,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
