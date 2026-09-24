/**
 * InProgressScreen — a whole screen whose data has no API yet. The screen title and a
 * single line saying the feature is in progress; nothing sampled, nothing invented.
 * The in-screen form is molecules/InProgressBlock.
 */

import { StyleSheet, View } from 'react-native';

import { useT } from '@/services/i18n';

import { Icon, Text } from '../atoms';
import { colors, space, type LayoutStyle } from '../tokens';
import { ScreenHeader } from './ScreenHeader';

export type InProgressScreenProps = {
  title: string;
  /** Supplied by a stack screen; a tab root has no back. */
  onBack?: () => void;
  testID?: string;
  style?: LayoutStyle;
};

// Header, then the one line, centred in the remaining space.
export function InProgressScreen({ title, onBack, testID, style }: InProgressScreenProps) {
  const t = useT();
  const line = t('common.inProgress');
  return (
    <View style={[styles.screen, style]} testID={testID}>
      <ScreenHeader title={title} onBack={onBack} />
      <View style={styles.body} accessible accessibilityLabel={`${title}. ${line}`}>
        <Icon name="clock" size="xl" color="figBeige" />
        <Text variant="figBodyLg" color="figChevron" align="center">
          {line}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.figScreen },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    padding: space[4],
  },
});
