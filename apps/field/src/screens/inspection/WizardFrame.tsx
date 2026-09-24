import { forwardRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { ScreenHeader, useTabBarInset } from '@/design-system';
import { Notice, ProgressSegments, StepHeader, WButton, WIcon } from '@/design-system/organisms/wizard/kit';
import { wizardColors, wizardMetrics as m, type WizardColor } from '@/design-system/tokens/wizard';
import { useT } from '@/services/i18n';
import type { RoundNotice } from '@/services/inspection/rounds';
import { STEP_COUNT } from '@/services/inspection/rounds';

export type WizardFrameProps = {
  caseRef: string;
  /** 1-based, matching "STEP n OF 4". */
  step: number;
  title: string;
  body: string;
  bodyColor?: WizardColor;
  /** What the round's state means for this step, if anything. */
  notice?: RoundNotice | null;
  onRetryRound?: () => void;
  /** Header back: one step back, or leave on step 1 (the layout asks first). */
  onBack: () => void;
  children: React.ReactNode;
};

/*
 * Frames 04–07: the title header, then one scrolling column — the four-segment
 * progress, "STEP n OF 4" with the step's title and instruction, the step's
 * content and its own action row, as the frames draw them (179:5886).
 */
export const WizardFrame = forwardRef<ScrollView, WizardFrameProps>(function WizardFrame(
  { caseRef, step, title, body, bodyColor, notice, onRetryRound, onBack, children },
  ref,
) {
  const t = useT();
  const tabInset = useTabBarInset();
  return (
    <View style={styles.screen}>
      <ScreenHeader
        variant="title"
        title={t('wizard.header.title')}
        subtitle={caseRef}
        onBack={onBack}
        backAccessibilityLabel={step === 1 ? t('wizard.exitA11y') : t('wizard.header.backHint')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          ref={ref}
          contentContainerStyle={[styles.body, { paddingBottom: m.padBottom + tabInset }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <ProgressSegments current={step} total={STEP_COUNT} />
          <StepHeader current={step} total={STEP_COUNT} title={title} body={body} bodyColor={bodyColor} />
          {notice === 'offlineResumed' ? <Notice tone="warn" icon="offline" body={t('wizard.notice.offlineResumed')} /> : null}
          {notice === 'offlineNotOpen' ? <Notice tone="warn" icon="offline" body={t('wizard.notice.offlineNotOpen')} /> : null}
          {notice === 'refused' ? (
            <Notice tone="error" title={t('wizard.notice.refusedTitle')} body={t('wizard.notice.refused')}>
              {onRetryRound ? (
                <WButton label={t('common.retry')} variant="secondary" onPress={onRetryRound} leading={<WIcon name="sync" size={18} />} />
              ) : null}
            </Notice>
          ) : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wizardColors.screen },
  flex: { flex: 1 },
  body: { paddingHorizontal: m.padX, paddingTop: m.padTop + 25, gap: m.gap },
});
