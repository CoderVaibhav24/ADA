/**
 * WizardStepTemplate — all four inspection steps. Header with exit, stepper, scrolling
 * body, footer-anchored Back and Next. Four screens, one template: build them separately
 * and the stepper and the exit confirmation drift apart within a week (ui-registry.md §3).
 */

import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, Text } from '../atoms';
import { StepperBar } from '../molecules';
import { colors, control, layout, space, type LayoutStyle } from '../tokens';
import { ScreenHeader } from './ScreenHeader';

export type WizardStepTemplateProps = {
  title: string;
  steps: readonly string[];
  /** 1-based, matching "STEP n OF 4". */
  current: number;
  children: React.ReactNode;
  /** Asks once, states that the draft is kept, and keeps it (ui-rules.md §5). */
  onExit: () => void;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  backLabel?: string;
  /** Disabling Next is only honest alongside `blockedReason`. */
  nextDisabled?: boolean;
  nextLoading?: boolean;
  /** States what is missing and what to do about it, on screen, not in a toast. */
  blockedReason?: string;
  /** SyncQueueBanner, offline notice, permission denial. */
  banner?: React.ReactNode;
  style?: LayoutStyle;
};

// Back and Next sit in the footer because the app is used one-handed (ui-rules.md §9).
export function WizardStepTemplate({
  title,
  steps,
  current,
  children,
  onExit,
  onBack,
  onNext,
  nextLabel = 'Next',
  backLabel = 'Back',
  nextDisabled = false,
  nextLoading = false,
  blockedReason,
  banner,
  style,
}: WizardStepTemplateProps) {
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, style]}>
      <ScreenHeader
        title={title}
        actions={
          <Button
            label="Exit"
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={onExit}
            accessibilityLabel="Exit the inspection"
            accessibilityHint="Your draft is kept"
            leadingIcon={<Icon name="close" size="md" color="brand" />}
          />
        }
        subtitle={<StepperBar steps={steps} current={current} />}
      />

      {banner ? <View style={styles.banner}>{banner}</View> : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {children}
        </ScrollView>

        <View style={styles.footer}>
          {blockedReason ? (
            <Text variant="caption" color="priorityMedium" accessibilityLiveRegion="polite">
              {blockedReason}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {onBack ? (
              <Button
                label={backLabel}
                variant="secondary"
                onPress={onBack}
                style={styles.action}
                accessibilityHint="Keeps everything you have entered"
              />
            ) : null}
            <Button
              label={nextLabel}
              variant="primary"
              onPress={onNext}
              disabled={nextDisabled}
              loading={nextLoading}
              style={styles.action}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  flex: { flex: 1 },
  banner: { paddingHorizontal: space[4], paddingBottom: space[3] },
  body: { padding: space[4], gap: space[5], paddingBottom: space[8] },
  footer: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    // space[6] above the home indicator keeps Back and Next clear of the gesture area.
    paddingBottom: space[6],
    borderTopWidth: control.hairline,
    borderTopColor: colors.line2,
    backgroundColor: colors.surface1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.footerActions,
  },
  action: { flex: 1 },
});
