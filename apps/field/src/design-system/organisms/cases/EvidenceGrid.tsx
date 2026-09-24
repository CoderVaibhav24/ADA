/**
 * "Submitted Evidence" tiles (Figma 03/10, 174:5571 sibling): two columns, 80 high,
 * teal hairline. Bytes come from the authenticated content endpoint. A tap opens the
 * photo full screen. Append-only: nothing here removes evidence.
 */

import { Image } from 'expo-image';
import ImageOff from 'lucide-react-native/icons/image-off';
import X from 'lucide-react-native/icons/x';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEvidenceImageSource } from '@/services/api/evidence-content';
import { useT } from '@/services/i18n';

import { caseMetrics, casePalette } from '../../tokens';
import { CaseIcon, CaseText, SkeletonBlock } from './primitives';

export type EvidenceItem = {
  readonly id: number;
  readonly contentUrl: string;
  readonly isImage: boolean;
  readonly name: string | null;
};

const TILE_WIDTH = 135.25;

// The image behind one tile or the viewer, with the bearer attached.
function EvidenceImage({ item, fit }: { item: EvidenceItem; fit: 'cover' | 'contain' }) {
  const t = useT();
  const source = useEvidenceImageSource(item.id, item.contentUrl);
  const [failed, setFailed] = useState(false);
  if (!item.isImage || source.status === 'unavailable' || failed) {
    return (
      <View style={styles.missing}>
        <CaseIcon glyph={ImageOff} size={20} color="viewInk" />
        <CaseText kind="cardFoot" color="viewInk" align="center" numberOfLines={2}>
          {item.name ?? t('caseDetail.photoMissing')}
        </CaseText>
      </View>
    );
  }
  if (source.status === 'loading') return <SkeletonBlock height={caseMetrics.evidenceHeight} />;
  return (
    <Image
      source={{ uri: source.source.uri, headers: { ...source.source.headers }, cacheKey: source.source.cacheKey }}
      cachePolicy="memory"
      contentFit={fit}
      style={styles.fill}
      onError={() => setFailed(true)}
    />
  );
}

export function EvidenceGrid({ items }: { items: readonly EvidenceItem[] }) {
  const t = useT();
  const [open, setOpen] = useState<EvidenceItem | null>(null);
  return (
    <>
      <View style={styles.grid}>
        {items.map((item, index) => (
          <Pressable
            key={item.id}
            onPress={() => setOpen(item)}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('caseDetail.photoA11y', { index: index + 1, total: items.length })}
            style={styles.tile}
          >
            <EvidenceImage item={item} fit="cover" />
          </Pressable>
        ))}
      </View>
      <Modal visible={open !== null} animationType="fade" onRequestClose={() => setOpen(null)} transparent>
        <SafeAreaView style={styles.viewer}>
          <Pressable
            onPress={() => setOpen(null)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            style={styles.close}
          >
            <CaseIcon glyph={X} size={22} color="white" />
            <CaseText kind="buttonBack">{t('common.close')}</CaseText>
          </Pressable>
          <View style={styles.full}>{open ? <EvidenceImage item={open} fit="contain" /> : null}</View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: caseMetrics.evidenceGap },
  tile: {
    width: TILE_WIDTH,
    height: caseMetrics.evidenceHeight,
    backgroundColor: casePalette.evidenceTile,
    borderWidth: caseMetrics.hairline,
    borderColor: casePalette.evidenceBorder,
    borderRadius: caseMetrics.evidenceRadius,
    overflow: 'hidden',
  },
  fill: { width: '100%', height: '100%' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6 },
  viewer: { flex: 1, backgroundColor: casePalette.scrim },
  close: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: caseMetrics.touch,
    paddingHorizontal: 16,
    margin: 8,
    borderRadius: caseMetrics.buttonRadius,
    backgroundColor: casePalette.secondary,
  },
  full: { flex: 1 },
});
