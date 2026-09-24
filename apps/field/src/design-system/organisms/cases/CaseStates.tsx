/**
 * The one block every case screen uses for empty / error / offline, each with its
 * next step. (The offline and waiting-upload banner is the shell's PendingBanner.)
 */

import Inbox from 'lucide-react-native/icons/inbox';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import WifiOff from 'lucide-react-native/icons/wifi-off';
import { StyleSheet, View } from 'react-native';

import { errorText } from '@/services/api/error-text';
import { useT } from '@/services/i18n';

import type { LayoutStyle } from '../../tokens';

import { CaseIcon, CaseText, SecondaryButton } from './primitives';

export type CaseStateProps = {
  kind: 'empty' | 'error';
  title: string;
  body?: string;
  /** For errors: the thrown error, read for offline and the support code. */
  error?: unknown;
  actionLabel?: string;
  onAction?: () => void;
  style?: LayoutStyle;
};

// Icon, title, what to do next, and one action. Errors never show raw server codes.
export function CaseState({ kind, title, body, error, actionLabel, onAction, style }: CaseStateProps) {
  const t = useT();
  const failure = kind === 'error' ? errorText(error) : null;
  const offline = failure?.offline === true;
  const glyph = kind === 'empty' ? Inbox : offline ? WifiOff : TriangleAlert;
  const heading = offline ? t('cases.offline.title') : title;
  const next = offline ? t('cases.offline.body') : kind === 'error' ? t('cases.error.body') : body;
  return (
    <View style={[styles.state, style]} accessibilityRole={kind === 'error' ? 'alert' : undefined}>
      <CaseIcon glyph={glyph} size={36} color={kind === 'error' && !offline ? 'statusSentBack' : 'viewInk'} />
      <CaseText kind="inspTitle" align="center">
        {heading}
      </CaseText>
      {next ? (
        <CaseText kind="body" color="viewInk" align="center">
          {next}
        </CaseText>
      ) : null}
      {failure?.requestId && !offline ? (
        <CaseText kind="cardFoot" color="viewInk" align="center" selectable>
          {t('cases.error.reference', { id: failure.requestId })}
        </CaseText>
      ) : null}
      {onAction ? (
        <SecondaryButton
          label={actionLabel ?? t('common.retry')}
          onPress={onAction}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 40 },
  action: { marginTop: 8 },
});
