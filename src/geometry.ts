/**
 * GeoJSON geometry, representative points and the zoom level from which a line or polygon is drawn with its outline.
 *
 * Positions are [longitude, latitude] in degrees (WGS 84), as in GeoJSON (RFC 7946). Sizes on the screen are computed
 * in the Web Mercator projection used by MapLibre GL JS, Mapbox GL JS, Leaflet and OpenLayers.
 */

export type Position = readonly [number, number, ...number[]] | readonly number[];

export type Geometry =
  | { readonly type: "Point"; readonly coordinates: Position }
  | { readonly type: "MultiPoint"; readonly coordinates: readonly Position[] }
  | { readonly type: "LineString"; readonly coordinates: readonly Position[] }
  | { readonly type: "MultiLineString"; readonly coordinates: readonly (readonly Position[])[] }
  | { readonly type: "Polygon"; readonly coordinates: readonly (readonly Position[])[] }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly (readonly (readonly Position[])[])[] }
  | { readonly type: "GeometryCollection"; readonly geometries: readonly Geometry[] };

/** The largest latitude of the Web Mercator projection. */
const MAX_LATITUDE = 85.0511287798066;

/** Longitude as a fraction of the width of the world, from 0 at 180° W to 1 at 180° E. */
export const mercatorX = (lng: number): number => (lng + 180) / 360;

/** Latitude as a fraction of the height of the world, from 0 at the top to 1 at the bottom. */
export function mercatorY(lat: number): number {
  const sin = Math.sin((Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

/** The longitude of a fraction of the width of the world, in [-180, 180). */
export function longitudeOf(x: number): number {
  const wrapped = x - Math.floor(x);
  return wrapped * 360 - 180;
}

/** The latitude of a fraction of the height of the world. */
export const latitudeOf = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

type Part = { readonly kind: "point" | "line" | "polygon"; readonly coordinates: unknown };

/** The single points, lines and polygons of a geometry: the members of multi-geometries and collections. */
function partsOf(geometry: Geometry | null | undefined, into: Part[] = []): Part[] {
  if (!geometry) return into;
  switch (geometry.type) {
    case "Point":
      into.push({ kind: "point", coordinates: geometry.coordinates });
      break;
    case "MultiPoint":
      for (const c of geometry.coordinates) into.push({ kind: "point", coordinates: c });
      break;
    case "LineString":
      into.push({ kind: "line", coordinates: geometry.coordinates });
      break;
    case "MultiLineString":
      for (const c of geometry.coordinates) into.push({ kind: "line", coordinates: c });
      break;
    case "Polygon":
      into.push({ kind: "polygon", coordinates: geometry.coordinates });
      break;
    case "MultiPolygon":
      for (const c of geometry.coordinates) into.push({ kind: "polygon", coordinates: c });
      break;
    case "GeometryCollection":
      for (const member of geometry.geometries) partsOf(member, into);
      break;
  }
  return into;
}

/** Every position of a part of a geometry. */
function eachPosition(coordinates: unknown, visit: (lng: number, lat: number) => void): void {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return;
  if (typeof coordinates[0] === "number") {
    const [lng, lat] = coordinates as number[];
    if (Number.isFinite(lng) && Number.isFinite(lat)) visit(lng as number, lat as number);
    return;
  }
  for (const inner of coordinates) eachPosition(inner, visit);
}

/**
 * The range of longitudes of a set of positions, taken across the antimeridian when that range is narrower: a shape
 * split at 180° (as RFC 7946 asks) spans a few degrees, not the whole world.
 * Returns [west, east] with west <= east; east may exceed 180.
 */
function longitudeRange(longitudes: readonly number[]): [number, number] | null {
  if (longitudes.length === 0) return null;
  let west = Infinity,
    east = -Infinity,
    west360 = Infinity,
    east360 = -Infinity;
  for (const lng of longitudes) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    const shifted = lng < 0 ? lng + 360 : lng;
    west360 = Math.min(west360, shifted);
    east360 = Math.max(east360, shifted);
  }
  return east360 - west360 < east - west ? [west360, east360] : [west, east];
}

/**
 * A point that stands for a geometry on a map: the position of a single point, otherwise the centre of the bounding
 * box of all its positions, taken across the antimeridian when the shape crosses it. Returns null for an empty or
 * missing geometry.
 */
export function representativePoint(geometry: Geometry | null | undefined): [number, number] | null {
  if (geometry?.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng as number, lat as number] : null;
  }
  const longitudes: number[] = [];
  let south = Infinity,
    north = -Infinity;
  for (const part of partsOf(geometry)) {
    eachPosition(part.coordinates, (lng, lat) => {
      longitudes.push(lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    });
  }
  const range = longitudeRange(longitudes);
  if (!range) return null;
  const centre = (range[0] + range[1]) / 2;
  return [centre >= 180 ? centre - 360 : centre, (south + north) / 2];
}

/** The size of a line or polygon on the map at zoom level 0, as a fraction of the width of the world. */
function sizeOf(part: Part): number {
  const longitudes: number[] = [];
  const latitudes: number[] = [];
  eachPosition(part.coordinates, (lng, lat) => {
    longitudes.push(lng);
    latitudes.push(lat);
  });
  const range = longitudeRange(longitudes);
  if (!range) return 0;
  // Positions taken to the same side of the antimeridian as the range.
  const unwrap = range[1] > 180 ? (lng: number) => (lng < 0 ? lng + 360 : lng) : (lng: number) => lng;
  const width = (range[1] - range[0]) / 360;
  let top = Infinity,
    bottom = -Infinity;
  for (const lat of latitudes) {
    const y = mercatorY(lat);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  let size = Math.max(width, bottom - top) / 2;
  if (part.kind === "polygon") {
    const rings = part.coordinates as readonly (readonly Position[])[];
    let area = 0;
    rings.forEach((ring, index) => {
      let twice = 0;
      for (let i = 1; i < ring.length; i++) {
        const [lng1 = 0, lat1 = 0] = ring[i - 1] ?? [];
        const [lng2 = 0, lat2 = 0] = ring[i] ?? [];
        twice += mercatorX(unwrap(lng1)) * mercatorY(lat2) - mercatorX(unwrap(lng2)) * mercatorY(lat1);
      }
      // The first ring is the outer boundary, the others are holes.
      area += (index === 0 ? 1 : -1) * Math.abs(twice / 2);
    });
    size = Math.max(size, Math.sqrt(Math.max(0, area)));
  }
  return size;
}

export interface OutlineOptions {
  /** The size on the screen, in pixels, from which a line or polygon is drawn with its outline. */
  readonly outlinePx: number;
  /** The width of a map tile in pixels: 512 for MapLibre GL JS and Mapbox GL JS, 256 for Leaflet and OpenLayers. */
  readonly tileSize: number;
  /** The highest zoom level of the map. */
  readonly maxZoom: number;
}

/**
 * The first whole zoom level at which a line or polygon measures at least `outlinePx` on the screen, so that it can be
 * drawn with its outline instead of a point marker. Infinity for a geometry with no line or polygon, or one too small
 * to reach that size by `maxZoom`.
 *
 * The size of a polygon is the larger of the side of the square of its area and half its longest extent; the size of a
 * line is half its longest extent. A multi-part geometry takes the size of its largest part, so that scattered small
 * islands are not drawn as outlines while each of them is still a speck.
 */
export function outlineZoom(geometry: Geometry | null | undefined, options: OutlineOptions): number {
  let size = 0;
  for (const part of partsOf(geometry)) {
    if (part.kind !== "point") size = Math.max(size, sizeOf(part));
  }
  if (!(size > 0)) return Infinity;
  const zoom = Math.max(0, Math.ceil(Math.log2(options.outlinePx / (size * options.tileSize)) - 1e-9));
  return zoom <= options.maxZoom ? zoom : Infinity;
}
