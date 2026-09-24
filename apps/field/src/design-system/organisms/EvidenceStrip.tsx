/**
 * EvidenceStrip — what was captured on one inspection round, as the server holds it.
 *
 * Append-only: there is no delete or remove control here, and none may be added
 * (ui-rules.md §4, code-standards.md rule 6). Each tile states its provenance from
 * the payload — capture source, whether the server flagged the geotag, the accuracy —
 * and the bytes come from the authenticated content endpoint with the bearer attached.
 */

import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useEvidenceImageSource } from '@/services/api/evidence-content';
import { errorText, isNotFound } from '@/services/api/error-text';
import { useInspectionEvidence, type Evidence } from '@/services/api/inspection-reads';
import { humanizeCode } from '@/services/config/labels';
import { formatDateTime } from '@/services/format/datetime';
import { useT, type TFunction } from '@/services/i18n';

import { Button, Icon, Skeleton, Text } from '../atoms';
import { colors, media, radius, space, type LayoutStyle } from '../tokens';

export type EvidenceStripProps = {
  inspectionRef: string;
  style?: LayoutStyle;
};

// True when the stored bytes are an image the tile can draw.
function isImage(evidence: Evidence): boolean {
  return evidence.content_type?.startsWith('image/') === true;
}

// One line of provenance, from the payload only, in words.
function provenanceOf(evidence: Evidence, t: TFunction): { text: string; flagged: boolean } {
  const parts: string[] = [];
  if (evidence.capture_source === 'camera') parts.push(t('evidence.camera'));
  else if (evidence.capture_source === 'gallery') parts.push(t('evidence.gallery'));
  else if (evidence.capture_source) parts.push(humanizeCode(evidence.capture_source));
  if (evidence.geotag_flagged) {
    parts.push(t('evidence.flagged'));
  } else if (evidence.accuracy_m !== null && evidence.accuracy_m !== undefined) {
    parts.push(t('evidence.accuracy', { meters: Math.round(evidence.accuracy_m) }));
  }
  return { text: parts.join(' · '), flagged: evidence.geotag_flagged };
}

// A neutral tile for media that cannot be shown — never styled as an error.
function UnavailableMedia() {
  return (
    <View style={[styles.media, styles.document]}>
      <Icon name="offline" size="lg" color="ink3" />
    </View>
  );
}

// The image, fetched with the bearer; a document shows its kind and name instead.
function EvidenceMedia({ evidence, label }: { evidence: Evidence; label: string }) {
  const source = useEvidenceImageSource(evidence.id, evidence.content_url);
  // `content_url` 404s for a round the server has since narrowed away from this caller.
  const [contentUnavailable, setContentUnavailable] = useState(false);

  if (!isImage(evidence)) {
    return (
      <View style={[styles.media, styles.document]}>
        <Icon name="document" size="lg" color="ink2" />
        <Text variant="caption" color="ink2" numberOfLines={2} align="center">
          {evidence.original_filename ?? humanizeCode(evidence.kind)}
        </Text>
      </View>
    );
  }
  if (source.status === 'loading') {
    return <Skeleton width={media.thumbnail} height={media.thumbnail} shape="md" />;
  }
  if (source.status === 'unavailable' || contentUnavailable) {
    return <UnavailableMedia />;
  }
  return (
    <Image
      source={{
        uri: source.source.uri,
        headers: { ...source.source.headers },
        cacheKey: source.source.cacheKey,
      }}
      cachePolicy="memory"
      contentFit="cover"
      style={styles.media}
      accessibilityLabel={label}
      onError={() => setContentUnavailable(true)}
    />
  );
}

// One tile: media, provenance, capture time. No remove control, by rule.
function EvidenceTile({ evidence }: { evidence: Evidence }) {
  const t = useT();
  const provenance = provenanceOf(evidence, t);
  const when = formatDateTime(
    evidence.captured_at ?? evidence.device_timestamp ?? evidence.uploaded_at,
  );
  return (
    <View style={styles.tile}>
      <EvidenceMedia evidence={evidence} label={t('evidence.a11y', { provenance: provenance.text })} />
      {provenance.text !== '' ? (
        <View style={styles.provenance}>
          <Icon
            name={provenance.flagged ? 'warning' : 'location'}
            size="sm"
            color={provenance.flagged ? 'gpsWeak' : 'gpsLocked'}
          />
          <Text variant="caption" color="ink2" numberOfLines={2} style={styles.flex}>
            {provenance.text}
          </Text>
        </View>
      ) : null}
      {when ? (
        <Text variant="caption" color="ink3" numberOfLines={2}>
          {when}
        </Text>
      ) : null}
    </View>
  );
}

export function EvidenceStrip({ inspectionRef, style }: EvidenceStripProps) {
  const t = useT();
  const query = useInspectionEvidence(inspectionRef);

  if (query.isPending) {
    return (
      <View style={[styles.row, style]}>
        <Skeleton width={media.thumbnail} height={media.thumbnail} shape="md" />
        <Skeleton width={media.thumbnail} height={media.thumbnail} shape="md" />
      </View>
    );
  }

  if (query.error !== null && query.data === undefined) {
    // Narrowed away from this caller (a reassigned round, or a stale cached reference):
    // this round's evidence is absent, not broken, so no alert styling and no retry.
    if (isNotFound(query.error)) {
      return (
        <View style={style}>
          <Text variant="body" color="ink3">
            {t('evidence.notAvailable')}
          </Text>
        </View>
      );
    }
    const failure = errorText(query.error);
    return (
      <View style={[styles.errorRow, style]} accessibilityRole="alert">
        <Icon name="alert" size="md" color="statusOverdue" />
        <Text variant="body" color="ink1" style={styles.flex}>
          {failure.offline ? t('wizard.err.server.offline') : t('evidence.loadFailed')}
        </Text>
        <Button
          label={t('common.retry')}
          onPress={() => void query.refetch()}
          variant="ghost"
          size="sm"
          fullWidth={false}
        />
      </View>
    );
  }

  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <View style={style}>
        <Text variant="body" color="ink3">
          {t('evidence.none')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={style}
    >
      {items.map((evidence) => (
        <EvidenceTile key={evidence.id} evidence={evidence} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[3] },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  tile: { width: media.thumbnail, gap: space[1] },
  media: {
    width: media.thumbnail,
    height: media.thumbnail,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  document: { alignItems: 'center', justifyContent: 'center', gap: space[1], padding: space[2] },
  provenance: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  flex: { flex: 1 },
});
