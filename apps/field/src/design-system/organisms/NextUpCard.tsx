/**
 * NextUpCard — the NEXT UP block of Home (173:4641): the first case in the officer's
 * active work, with Open Complaint. The row is whatever the register returned first;
 * nothing is picked on the handset.
 */

import { StyleSheet, View } from 'react-native';

import type { CaseRow } from '@/services/api/case-reads';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { formatAge } from '@/services/format/datetime';
import { useT } from '@/services/i18n';

import { Button, Glyph, Icon, Skeleton, Text } from '../atoms';
import { colors, control, elevation, figCard, radius, space, type LayoutStyle } from '../tokens';

export type NextUpCardProps = {
  /** undefined while loading; null when there is nothing waiting. */
  row: CaseRow | null | undefined;
  /** The server's message when the read failed. */
  errorMessage?: string | null;
  onOpen: (caseRef: string) => void;
  onRetry?: () => void;
  style?: LayoutStyle;
};

// The card shell every state shares.
function Card({ children, alert = false, style }: { children: React.ReactNode; alert?: boolean; style?: LayoutStyle }) {
  return (
    <View style={[styles.card, style]} accessibilityRole={alert ? 'alert' : undefined}>
      {children}
    </View>
  );
}

// Heading, then one of four states: loading, failed, nothing waiting, the case.
export function NextUpCard({ row, errorMessage, onOpen, onRetry, style }: NextUpCardProps) {
  const t = useT();
  const statusLabel = useCodeLabel(LABEL_DOMAINS.caseStatus);

  let body: React.ReactNode;
  if (errorMessage) {
    body = (
      <Card alert>
        <View style={styles.row}>
          <Icon name="alert" size="md" color="figDanger" />
          <Text variant="figBody" color="white" style={styles.flex}>
            {errorMessage}
          </Text>
        </View>
        {onRetry ? (
          <Button
            label={t('common.retry')}
            onPress={onRetry}
            variant="figSecondary"
            leadingIcon={<Icon name="sync" size="sm" color="white" />}
          />
        ) : null}
      </Card>
    );
  } else if (row === undefined) {
    body = (
      <Card>
        <Skeleton height={space[4]} width="40%" tone="figControl" />
        <Skeleton height={space[6]} width="75%" tone="figControl" />
        <Skeleton height={space[4]} width="90%" tone="figControl" />
        <Skeleton height={control.heightMd} shape="md" tone="figControl" />
      </Card>
    );
  } else if (row === null) {
    body = (
      <Card>
        <View style={styles.row}>
          <Icon name="success" size="md" color="figSuccess" />
          <Text variant="figCardTitle" color="white" style={styles.flex}>
            {t('shell.home.nothingWaiting')}
          </Text>
        </View>
        <Text variant="figBody" color="figMuted">
          {t('shell.home.nothingWaitingBody')}
        </Text>
      </Card>
    );
  } else {
    const type = row.complaint_type_label ?? row.other_type ?? row.case_ref;
    const place = row.property_address ?? row.landmark ?? row.zone_name;
    const age = formatAge(row.raised_at);
    const meta = [place, row.parcel_id ? t('shell.home.parcel', { id: row.parcel_id }) : null]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · ');
    body = (
      <Card>
        <View style={styles.topRow}>
          <Text variant="figCardTime" color="figAccent" style={styles.flex} numberOfLines={1}>
            {age ? t('shell.home.raised', { age }) : row.case_ref}
          </Text>
          <View style={styles.pill}>
            <View style={styles.pillDot} />
            <Text variant="figPill" color="figPillInk" numberOfLines={1}>
              {statusLabel(row.status)}
            </Text>
          </View>
        </View>
        <Text variant="figCardTitle" color="white">
          {type}
        </Text>
        <View style={styles.metaRow}>
          <View style={styles.pin}>
            <Glyph name="pin" color="figBeige" />
          </View>
          <Text variant="figMeta" color="figBeige" style={styles.flex}>
            {[row.case_ref, meta].filter((part) => part !== '').join(' · ')}
          </Text>
        </View>
        <Button
          label={t('shell.home.openComplaint')}
          onPress={() => onOpen(row.case_ref)}
          variant="figPrimary"
          accessibilityLabel={t('shell.home.openComplaintA11y', { caseRef: row.case_ref })}
          trailingIcon={<Glyph name="chevronRight" color="white" />}
          testID="next-up-open"
        />
      </Card>
    );
  }

  return (
    <View style={[styles.section, style]}>
      <Text variant="figSection" color="figBeige" accessibilityRole="header" style={styles.heading}>
        {t('shell.home.nextUp')}
      </Text>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: figCard.headingGap },
  heading: { paddingHorizontal: space[1] },
  card: {
    gap: figCard.cardGap,
    padding: figCard.cardPad,
    borderRadius: figCard.cardRadius,
    borderWidth: control.hairline,
    borderColor: colors.figCardBorder,
    backgroundColor: colors.figCard,
    ...elevation.figCard,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: figCard.pillDot,
    paddingHorizontal: figCard.pillPadX,
    paddingVertical: figCard.pillPadY,
    borderRadius: radius.pill,
    borderWidth: control.hairline,
    borderColor: colors.figPillBorder,
    backgroundColor: colors.figPillFill,
    flexShrink: 1,
  },
  pillDot: { width: figCard.pillDot, height: figCard.pillDot, borderRadius: radius.pill, backgroundColor: colors.figPillInk },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: figCard.cardGap, paddingBottom: figCard.metaPadBottom },
  pin: { paddingTop: figCard.pinTop },
  flex: { flex: 1 },
});
