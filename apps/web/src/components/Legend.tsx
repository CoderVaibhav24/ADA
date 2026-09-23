export default function Legend() {
  return (
    <div className="map-legend">
      <div className="legend-title">Legend</div>
      <ul>
        <li>
          <span className="legend-swatch legend-raster" />
          T1 / T2 imagery (uploaded maps)
        </li>
        <li>
          <span className="legend-swatch legend-heat" />
          Change heat (pixel-level)
        </li>
        <li>
          <span className="legend-swatch legend-change" />
          New construction / change
        </li>
        <li>
          <span className="legend-swatch legend-illegal" />
          Illegal encroachment
        </li>
        <li>
          <span className="legend-swatch legend-redzone" />
          Red zone (prohibited area)
        </li>
      </ul>
    </div>
  );
}
