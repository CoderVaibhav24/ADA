import { StyleSheet, View } from 'react-native';

import { caseMetrics, casePalette } from '../../tokens';

const ROWS = [0, 1, 2] as const;
const COLS = [0, 1, 2, 3, 4] as const;

// Figma's stylised 5x3 parcel grid, shown when there is no point or no native map.
export function MapPlaceholder({ hasPoint }: { hasPoint: boolean }) {
  return (
    <View style={styles.grid}>
      {ROWS.map((row) => (
        <View key={row} style={styles.gridRow}>
          {COLS.map((col) => {
            const target = row === 1 && col === 2;
            return (
              <View key={col} style={[styles.cell, target ? styles.target : null]}>
                {target && hasPoint ? <View style={styles.pin} /> : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    ...StyleSheet.absoluteFill,
    backgroundColor: casePalette.mapGrid,
    padding: 2,
    gap: caseMetrics.mapGap,
  },
  gridRow: { flex: 1, flexDirection: 'row', gap: caseMetrics.mapGap },
  cell: { flex: 1, backgroundColor: casePalette.mapCell, alignItems: 'center', justifyContent: 'center' },
  target: {
    backgroundColor: casePalette.mapTarget,
    borderWidth: caseMetrics.hairline,
    borderStyle: 'dashed',
    borderColor: casePalette.mapTargetBorder,
  },
  pin: {
    width: caseMetrics.pinSize,
    height: caseMetrics.pinSize,
    borderRadius: caseMetrics.pinSize / 2,
    backgroundColor: casePalette.mapPin,
    borderWidth: caseMetrics.pinBorder,
    borderColor: casePalette.mapPinBorder,
    boxShadow: `0 0 10px ${casePalette.mapPinHalo}`,
  },
});
