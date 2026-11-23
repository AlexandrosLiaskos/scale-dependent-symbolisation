import { join, type JoinOptions, type Node } from "./clustering.js";
import { latitudeOf, longitudeOf, mercatorX, mercatorY, outlineZoom, representativePoint, type Geometry } from "./geometry.js";

/** A record to place on the map: its identifier and its GeoJSON geometry. */
export interface SymbolisationInput<Id> {
  readonly id: Id;
  readonly geometry: Geometry | null | undefined;
}

/** A record drawn as a point marker. */
export interface MarkerSymbol<Id> {
  readonly kind: "marker";
  readonly id: Id;
  /** [longitude, latitude] in degrees. */
  readonly position: readonly [number, number];
}

/** Several records drawn as one cluster. */
export interface ClusterSymbol<Id> {
  readonly kind: "cluster";
  readonly ids: readonly Id[];
  /** The number of records in the cluster. */
  readonly count: number;
  /** [longitude, latitude] in degrees: the weighted centre of the records. */
  readonly position: readonly [number, number];
}

export type MapSymbol<Id> = MarkerSymbol<Id> | ClusterSymbol<Id>;

export interface SymbolisationOptions {
  /** The size on the screen, in pixels, from which a line or polygon is drawn with its outline. Default 24. */
  readonly outlinePx?: number;
  /** Whether point markers that are close to one another are grouped in clusters. Default true. */
  readonly cluster?: boolean;
  /** Markers closer than this, in pixels, are grouped. Default 42. */
  readonly clusterDistancePx?: number;
  /** The free space, in pixels, kept between any two symbols, so that none touches another. Default 6. */
  readonly gapPx?: number;
  /** The radius of a point marker on the screen, in pixels, including its ring. Default 9.5. */
  readonly markerRadiusPx?: number;
  /** The radius of the disc of a cluster of `records` records, in pixels. Default 18, 21 or 24 px. */
  readonly clusterRadiusPx?: (records: number) => number;
  /** The highest zoom level at which clusters are formed; above it every marker stands alone. Default 11. */
  readonly clusterMaxZoom?: number;
  /** The highest zoom level of the map. Default 22. */
  readonly maxZoom?: number;
  /** The width of a map tile in pixels: 512 for MapLibre GL JS and Mapbox GL JS, 256 for Leaflet and OpenLayers. Default 512. */
  readonly tileSize?: number;
}

export const DEFAULT_OPTIONS = Object.freeze({
  outlinePx: 24,
  cluster: true,
  clusterDistancePx: 42,
  gapPx: 6,
  markerRadiusPx: 9.5,
  clusterRadiusPx: (records: number) => (records >= 100 ? 24 : records >= 10 ? 21 : 18),
  clusterMaxZoom: 11,
  maxZoom: 22,
  tileSize: 512,
});

type Resolved = Required<SymbolisationOptions>;

function resolve(options: SymbolisationOptions = {}): Resolved {
  const resolved: Resolved = { ...DEFAULT_OPTIONS, ...options };
  const positive = ["outlinePx", "clusterDistancePx", "markerRadiusPx", "tileSize"] as const;
  for (const name of positive) {
    const value = resolved[name];
    if (!(Number.isFinite(value) && value > 0)) throw new RangeError(`${name} must be a positive number, not ${String(value)}`);
  }
  if (!(Number.isFinite(resolved.gapPx) && resolved.gapPx >= 0))
    throw new RangeError(`gapPx must be zero or more, not ${String(resolved.gapPx)}`);
  for (const name of ["clusterMaxZoom", "maxZoom"] as const) {
    const value = resolved[name];
    if (!(Number.isInteger(value) && value >= 0 && value <= 30))
      throw new RangeError(`${name} must be a whole number from 0 to 30, not ${String(value)}`);
  }
  if (typeof resolved.clusterRadiusPx !== "function") throw new TypeError("clusterRadiusPx must be a function of the number of records");
  return resolved;
}

/** The point markers and clusters of a set of records at every zoom level. */
export interface Symbolisation<Id> {
  /**
   * The point markers and clusters to draw at a zoom level. A fractional zoom is taken down to its whole level, as map
   * libraries do for the zoom of their tiles; the symbols of a level stay clear of one another at every zoom up to the
   * next level, since distances on the screen only grow as the map is zoomed in.
   */
  symbolsAt(zoom: number): readonly MapSymbol<Id>[];
  /** The first whole zoom level at which the record is drawn with its outline; Infinity if never (points). */
  outlineZoomOf(id: Id): number;
  /** The position at which the record's point marker is drawn, or undefined for an unknown record or one without geometry. */
  positionOf(id: Id): readonly [number, number] | undefined;
  /** The options in effect, with the defaults filled in. */
  readonly options: Readonly<Resolved>;
}

interface Item<Id> {
  readonly id: Id;
  readonly position: readonly [number, number];
  readonly x: number;
  readonly y: number;
  readonly outline: number;
}

/**
 * Decides how every record is drawn at every zoom level: a line or polygon with its outline once it is large enough on
 * the screen, otherwise a point marker; with clustering, markers that would be too close are grouped.
 *
 * Every record is in exactly one form at each zoom level: drawn with its outline (`outlineZoomOf(id) <= zoom`), as a
 * marker, or within one cluster. Clusters nest: a cluster at one level is made of whole symbols of the next larger
 * level, so zooming in splits clusters and zooming out joins them, without reshuffling. Records without a geometry are
 * left out.
 */
export function symbolise<Id>(records: Iterable<SymbolisationInput<Id>>, options?: SymbolisationOptions): Symbolisation<Id> {
  const settings = resolve(options);
  const items = new Map<Id, Item<Id>>();
  for (const record of records) {
    const position = representativePoint(record.geometry);
    if (!position) continue;
    items.set(record.id, {
      id: record.id,
      position,
      x: mercatorX(position[0]),
      y: mercatorY(position[1]),
      outline: outlineZoom(record.geometry, settings),
    });
  }
  const single = (item: Item<Id>): Node<Id> => ({ x: item.x, y: item.y, ids: [item.id], position: item.position });

  // With clustering, the levels are made from the largest clustering zoom down: each from the symbols of the level above
  // and the records that become markers at it (those drawn with their outline one level up).
  const levels = new Map<number, Node<Id>[]>();
  if (settings.cluster) {
    const top = settings.clusterMaxZoom;
    const arriving = new Map<number, Node<Id>[]>();
    for (const item of items.values()) {
      const level = Math.min(top, item.outline - 1);
      if (level < 0) continue;
      const list = arriving.get(level);
      if (list) list.push(single(item));
      else arriving.set(level, [single(item)]);
    }
    const joinOptions: JoinOptions = settings;
    let nodes: Node<Id>[] = [];
    for (let zoom = top; zoom >= 0; zoom--) {
      nodes = join([...nodes, ...(arriving.get(zoom) ?? [])], zoom, joinOptions);
      levels.set(zoom, nodes);
    }
  }

  const symbols = new Map<number, readonly MapSymbol<Id>[]>();
  const symbolOf = (node: Node<Id>): MapSymbol<Id> => {
    const [only] = node.ids;
    if (node.ids.length === 1 && only !== undefined) {
      return { kind: "marker", id: only, position: node.position ?? [longitudeOf(node.x), latitudeOf(node.y)] };
    }
    return { kind: "cluster", ids: node.ids, count: node.ids.length, position: [longitudeOf(node.x), latitudeOf(node.y)] };
  };

  return {
    options: settings,
    symbolsAt(zoom: number) {
      const level = Number.isFinite(zoom) ? Math.max(0, Math.floor(zoom)) : 0;
      const known = symbols.get(level);
      if (known) return known;
      const nodes = levels.get(level) ?? [...items.values()].filter((item) => item.outline > level).map(single);
      const made = Object.freeze(nodes.map(symbolOf));
      symbols.set(level, made);
      return made;
    },
    outlineZoomOf: (id: Id) => items.get(id)?.outline ?? Infinity,
    positionOf: (id: Id) => items.get(id)?.position,
  };
}
