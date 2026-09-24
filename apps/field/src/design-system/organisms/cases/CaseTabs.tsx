/**
 * The filter tabs of Figma 02 (195:2353): label over a 4.6-high underline in the
 * active colour. Each tab carries its status icon too, so the row reads without colour.
 * Tabs filter in place; they never navigate.
 */

import type { LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useT } from '@/services/i18n';

import { caseMetrics, casePalette } from '../../tokens';
import { CaseIcon, CaseText } from './primitives';

export type CaseTab<K extends string> = { key: K; label: string; glyph: LucideIcon };

export type CaseTabsProps<K extends string> = {
  tabs: readonly CaseTab<K>[];
  active: K;
  onSelect: (key: K) => void;
};

export function CaseTabs<K extends string>({ tabs, active, onSelect }: CaseTabsProps<K>) {
  const t = useT();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const selected = tab.key === active;
        const color = selected ? 'tabActive' : 'tabIdle';
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t('cases.tab.a11y', { label: tab.label })}
            style={styles.tab}
          >
            <View style={styles.labelRow}>
              <CaseIcon glyph={tab.glyph} size={14} color={color} />
              <CaseText kind="tab" color={color}>
                {tab.label}
              </CaseText>
            </View>
            <View style={[styles.underline, selected ? styles.on : null]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: caseMetrics.tabGap - 8, paddingHorizontal: caseMetrics.gutter - 4 },
  tab: {
    minHeight: caseMetrics.touch,
    paddingHorizontal: 4,
    justifyContent: 'flex-end',
    gap: caseMetrics.tabUnderlineGap,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  underline: {
    height: caseMetrics.tabUnderline,
    borderTopLeftRadius: caseMetrics.tabUnderline,
    borderTopRightRadius: caseMetrics.tabUnderline,
    backgroundColor: casePalette.transparent,
  },
  on: { backgroundColor: casePalette.tabActive },
});
