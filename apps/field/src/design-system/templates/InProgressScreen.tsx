/**
 * InProgressScreen — a whole screen whose data has no API yet. The screen title and a
 * single line saying the feature is in progress; nothing sampled, nothing invented.
 * The in-screen form is molecules/InProgressBlock.
 */

import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Text } from '../atoms';
import { IN_PROGRESS_LINE } from '../molecules/InProgressBlock';
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
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, style]} testID={testID}>
      <ScreenHeader title={title} onBack={onBack} />
      <View style={styles.body} accessible accessibilityLabel={`${title}. ${IN_PROGRESS_LINE}`}>
        <Icon name="clock" size="xl" color="ink3" />
        <Text variant="body" color="ink2" align="center">
          {IN_PROGRESS_LINE}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    padding: space[4],
  },
});
