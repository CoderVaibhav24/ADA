import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  ConfirmDialog,
  Icon,
  OfflineBanner,
  ResultCard,
  ScreenHeader,
  StateMessage,
  Text,
  colors,
  shell,
  space,
  type ColorToken,
  type IconName,
} from '@/design-system';
import { formatDateTime } from '@/services/format/datetime';
import { useT, type PlainKey } from '@/services/i18n';
import {
  retryUploads,
  useOutbox,
  useOutboxDrain,
  type OutboxUpload,
  type UploadState,
} from '@/services/inspection/outbox';
import { discardRefusedSubmit, isRoundGone } from '@/services/inspection/submit';
import { cannotBeSent, stuckReason } from '@/services/storage/captures';

/*
 * Pending uploads — no frame. Every photo and arrival this phone still owes the
 * office, in plain words, and every inspection opened but not submitted. Reached from
 * the pending banner on every list and from Profile. No photo is deleted here: a failed
 * upload is retried or retaken, never dropped (code-standards.md §4). The one removal is
 * a submit for a case the office has changed, after the surveyor confirms. While the
 * screen is open it keeps sending, and sends again when the signal comes back.
 */
const STATE: Record<UploadState, { icon: IconName; tone: ColorToken; key: PlainKey }> = {
  waiting: { icon: 'offline', tone: 'figPillInk', key: 'shell.pending.state.waiting' },
  later: { icon: 'clock', tone: 'figBeige', key: 'shell.pending.state.later' },
  sending: { icon: 'upload', tone: 'figSuccess', key: 'shell.pending.state.sending' },
  failed: { icon: 'alert', tone: 'figDanger', key: 'shell.pending.state.failed' },
};

export function PendingUploadsScreen() {
  const router = useRouter();
  const t = useT();
  const outbox = useOutbox();
  const [retrying, setRetrying] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  useOutboxDrain(outbox.uploads.map((item) => item.caseRef));

  const retry = async (items: readonly OutboxUpload[]) => {
    setRetrying(true);
    try {
      await retryUploads(items);
    } finally {
      setRetrying(false);
    }
  };

  // Closes this screen and opens the wizard where it was left, inside the Complaints tab.
  const openRound = (caseRef: string) =>
    router.dismissTo({ pathname: '/inspection/[caseRef]', params: { caseRef } }, { withAnchor: true });

  // Opens the wizard's photos step for a photo that must be taken again.
  const openPhotos = (caseRef: string) =>
    router.dismissTo({ pathname: '/inspection/[caseRef]/photos', params: { caseRef } }, { withAnchor: true });

  // A photo row: the words and the tap for its state; one that cannot be sent is retaken, not retried.
  const photoRow = (item: OutboxUpload) => {
    if (item.kind !== 'photo') return null;
    if (cannotBeSent(item.record)) {
      return { text: t('shell.pending.state.retake'), onPress: () => openPhotos(item.caseRef), hint: t('shell.pending.retakeHint') };
    }
    if (stuckReason(item.record) === 'retry') {
      return { text: t('shell.pending.state.stuck'), onPress: () => void retry([item]), hint: t('shell.pending.retryHint') };
    }
    return null;
  };

  const confirmRemove = () => {
    if (removing !== null) discardRefusedSubmit(removing);
    setRemoving(null);
  };

  const empty = outbox.uploads.length === 0 && outbox.rounds.length === 0 && outbox.submits.length === 0;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t('shell.pending.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.navigate('/home'))}
      />
      <ScrollView contentContainerStyle={styles.body}>
        {!outbox.online ? <OfflineBanner offline waiting={0} failed={0} /> : null}

        {empty ? (
          <StateMessage tone="empty" title={t('shell.pending.empty')} message={t('shell.pending.emptyBody')} />
        ) : (
          <View style={styles.intro}>
            <Icon name="info" size="md" color="figBeige" />
            <Text variant="figBody" color="figChevron" style={styles.flex}>
              {outbox.online ? t('shell.pending.intro') : t('shell.pending.offline')}
            </Text>
          </View>
        )}

        {outbox.uploads.length > 0 ? (
          <View style={styles.section}>
            <Text variant="figSection" color="figBeige" accessibilityRole="header" style={styles.heading}>
              {t('shell.pending.sectionUploads')}
            </Text>
            {outbox.uploads.map((item) => {
              const state = STATE[item.state];
              const special = photoRow(item);
              const taken = formatDateTime(item.at);
              const label =
                item.kind === 'checkIn'
                  ? t('shell.pending.checkIn')
                  : item.record.geo.captureSource === 'gallery'
                    ? t('shell.pending.photoGallery')
                    : t('shell.pending.photo');
              return (
                <ResultCard
                  key={item.id}
                  testID={`pending-${item.id}`}
                  icon={item.kind === 'checkIn' ? 'location' : 'camera'}
                  title={item.caseRef}
                  lines={[label, taken ? t('shell.pending.takenAt', { time: taken }) : null]}
                  status={{ icon: state.icon, tone: state.tone, text: special?.text ?? t(state.key) }}
                  onPress={special?.onPress ?? (item.state === 'failed' ? () => void retry([item]) : undefined)}
                  accessibilityHint={special?.hint ?? (item.state === 'failed' ? t('shell.pending.retryHint') : undefined)}
                />
              );
            })}
            <Button
              testID="pending-retry-all"
              label={t('shell.pending.retryAll')}
              variant="figPrimary"
              onPress={() => void retry(outbox.uploads)}
              loading={retrying}
              accessibilityHint={t('shell.pending.retryAllHint')}
              leadingIcon={<Icon name="sync" size="md" color="white" />}
            />
          </View>
        ) : null}

        {outbox.submits.length > 0 ? (
          <View style={styles.section}>
            <Text variant="figSection" color="figBeige" accessibilityRole="header" style={styles.heading}>
              {t('shell.pending.sectionSubmits')}
            </Text>
            {outbox.submits.map((record) => {
              const refused = record.state === 'refused';
              const gone = isRoundGone(record);
              return (
                <View key={record.inspectionRef} style={styles.item}>
                  <ResultCard
                    testID={`pending-submit-${record.caseRef}`}
                    icon="upload"
                    title={record.caseRef}
                    lines={[t('shell.pending.submit'), record.inspectionRef]}
                    status={
                      gone
                        ? { icon: 'alert', tone: 'figDanger', text: t('shell.pending.state.submitGone') }
                        : refused
                          ? { icon: 'alert', tone: 'figDanger', text: t('shell.pending.state.submitRefused') }
                          : { icon: outbox.online ? 'clock' : 'offline', tone: 'figPillInk', text: t('shell.pending.state.submitQueued') }
                    }
                    onPress={refused && !gone ? () => openRound(record.caseRef) : undefined}
                    accessibilityHint={refused && !gone ? t('shell.pending.submitHint') : undefined}
                  />
                  {gone ? (
                    <Button
                      testID={`pending-remove-${record.caseRef}`}
                      label={t('shell.pending.remove')}
                      variant="figSecondary"
                      onPress={() => setRemoving(record.caseRef)}
                      accessibilityHint={t('shell.pending.removeHint')}
                      leadingIcon={<Icon name="remove" size="md" color="white" />}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {outbox.rounds.length > 0 ? (
          <View style={styles.section}>
            <Text variant="figSection" color="figBeige" accessibilityRole="header" style={styles.heading}>
              {t('shell.pending.sectionInspections')}
            </Text>
            {outbox.rounds.map(({ caseRef, round }) => (
              <ResultCard
                key={round.inspectionRef}
                testID={`pending-round-${caseRef}`}
                icon="inspections"
                title={caseRef}
                lines={[t('shell.pending.inspection'), round.inspectionRef]}
                status={{ icon: 'edit', tone: 'figPillInk', text: t('shell.pending.state.notSent') }}
                onPress={() => openRound(caseRef)}
                accessibilityHint={t('shell.pending.inspectionHint')}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        testID="pending-remove-dialog"
        visible={removing !== null}
        icon="remove"
        title={t('shell.pending.removeTitle')}
        body={t('shell.pending.removeBody')}
        confirmLabel={t('shell.pending.remove')}
        cancelLabel={t('shell.pending.removeKeep')}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.figScreen },
  body: { paddingHorizontal: shell.gutter, paddingTop: shell.contentTop, paddingBottom: space[8], gap: space[6] },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  flex: { flex: 1 },
  section: { gap: space[3] },
  item: { gap: space[2] },
  heading: { paddingHorizontal: space[1] },
});
