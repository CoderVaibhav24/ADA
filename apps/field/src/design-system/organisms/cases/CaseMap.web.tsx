import type { MapPoint } from './basemap';
import { MapPlaceholder } from './MapPlaceholder';

// MapLibre React Native has no web renderer; the web build keeps the stylised grid.
export function CaseMap(_props: { point: MapPoint }) {
  return <MapPlaceholder hasPoint />;
}
