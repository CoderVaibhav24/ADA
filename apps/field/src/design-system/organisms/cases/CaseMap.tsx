import { Camera, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { StyleSheet, View } from 'react-native';

import { caseMetrics, casePalette } from '../../tokens';
import { caseMapStyle, OSM_ATTRIBUTION, type MapPoint } from './basemap';
import { CaseText } from './primitives';

// Static MapLibre preview centred on the case; touches pass through to the card and the screen's ScrollView.
export function CaseMap({ point }: { point: MapPoint }) {
  return (
    <View style={styles.frame} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <MapLibreMap
        style={styles.map}
        mapStyle={caseMapStyle(point)}
        androidView="texture"
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        doubleTapHoldZoom={false}
        touchRotate={false}
        touchPitch={false}
        attribution={false}
        logo={false}
        compass={false}
        scaleBar={false}
      >
        <Camera center={[point.longitude, point.latitude]} zoom={caseMetrics.mapZoom} />
      </MapLibreMap>
      <View style={styles.attribution}>
        <CaseText kind="panelSub" color="mapAttributionInk">
          {OSM_ATTRIBUTION}
        </CaseText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { ...StyleSheet.absoluteFill, backgroundColor: casePalette.mapBackdrop },
  map: { flex: 1, backgroundColor: casePalette.mapBackdrop },
  attribution: {
    position: 'absolute',
    left: 0,
    top: 0,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderBottomRightRadius: 6,
    backgroundColor: casePalette.mapAttributionFill,
  },
});
