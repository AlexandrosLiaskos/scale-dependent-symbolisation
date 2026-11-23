import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, symbolise, type Geometry, type MapSymbol, type SymbolisationInput, type Symbolisation } from "../src/index.js";

/** A small deterministic random number generator (mulberry32), so that every run tests the same data. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points and polygons of many sizes around Greece and around the antimeridian. */
function sample(points: number, polygons: number, seed = 1): SymbolisationInput<number>[] {
  const next = random(seed);
  const records: SymbolisationInput<number>[] = [];
  for (let i = 0; i < points; i++) {
    const [lng, lat] = i % 5 === 0 ? [177 + next() * 6, -20 + next() * 6] : [19 + next() * 9, 34 + next() * 7];
    records.push({ id: records.length, geometry: { type: "Point", coordinates: [lng > 180 ? lng - 360 : lng, lat] } });
  }
  for (let i = 0; i < polygons; i++) {
    const lng = 19 + next() * 9;
    const lat = 34 + next() * 7;
    const side = 10 ** (-3 + next() * 3); // from 0.001° to 1°
    const ring = [
      [lng, lat],
      [lng + side, lat],
      [lng + side, lat + side],
      [lng, lat + side],
      [lng, lat],
    ];
    records.push({ id: records.length, geometry: { type: "Polygon", coordinates: [ring] } });
  }
  return records;
}

const WORLD = (zoom: number) => DEFAULT_OPTIONS.tileSize * 2 ** zoom;
const radius = (symbol: MapSymbol<number>) =>
  symbol.kind === "marker" ? DEFAULT_OPTIONS.markerRadiusPx : DEFAULT_OPTIONS.clusterRadiusPx(symbol.count);
const pixels = ([lng, lat]: readonly [number, number], zoom: number) => {
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * WORLD(zoom), (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * WORLD(zoom)] as const;
};
const idsOf = (symbol: MapSymbol<number>) => (symbol.kind === "marker" ? [symbol.id] : symbol.ids);

describe("symbolise", () => {
  const records = sample(1500, 400);
  const result = symbolise(records);

  it("draws every record in exactly one form at every zoom level", () => {
    for (let zoom = 0; zoom <= 16; zoom++) {
      const seen = new Map<number, number>();
      for (const symbol of result.symbolsAt(zoom)) for (const id of idsOf(symbol)) seen.set(id, (seen.get(id) ?? 0) + 1);
      for (const { id } of records) {
        const outlined = result.outlineZoomOf(id) <= zoom;
        expect(seen.get(id) ?? 0, `record ${id} at zoom ${zoom}`).toBe(outlined ? 0 : 1);
      }
    }
  });

  it("keeps every two symbols apart by at least the gap, across the antimeridian too", () => {
    for (let zoom = 0; zoom <= DEFAULT_OPTIONS.clusterMaxZoom; zoom++) {
      const symbols = result.symbolsAt(zoom).map((symbol) => ({ at: pixels(symbol.position, zoom), r: radius(symbol) }));
      // The smallest free space between two symbols of the level: distance less both radii.
      let tightest = Infinity;
      for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
          const a = symbols[i]!,
            b = symbols[j]!;
          let dx = Math.abs(a.at[0] - b.at[0]);
          dx = Math.min(dx, WORLD(zoom) - dx);
          tightest = Math.min(tightest, Math.hypot(dx, a.at[1] - b.at[1]) - a.r - b.r);
        }
      }
      expect(tightest, `zoom ${zoom}`).toBeGreaterThanOrEqual(DEFAULT_OPTIONS.gapPx - 1e-6);
    }
  });

  it("nests clusters: each symbol of a level lies wholly within one symbol of the level below", () => {
    for (let zoom = 0; zoom < DEFAULT_OPTIONS.clusterMaxZoom; zoom++) {
      const below = new Map<number, number>();
      result.symbolsAt(zoom).forEach((symbol, index) => idsOf(symbol).forEach((id) => below.set(id, index)));
      for (const symbol of result.symbolsAt(zoom + 1)) {
        const holders = new Set(idsOf(symbol).map((id) => below.get(id)));
        expect(holders.size, `zoom ${zoom + 1}`).toBe(1);
      }
    }
  });

  it("takes a fractional zoom down to its whole level", () => {
    expect(result.symbolsAt(7.9)).toBe(result.symbolsAt(7));
    expect(result.symbolsAt(-3)).toBe(result.symbolsAt(0));
  });

  it("places a marker exactly on its point", () => {
    const marker = result.symbolsAt(16).find((symbol) => symbol.kind === "marker" && symbol.id === 3);
    expect(marker?.position).toEqual((records[3]!.geometry as unknown as { coordinates: number[] }).coordinates);
  });

  it("is the same for the same records", () => {
    const again = symbolise(records);
    for (const zoom of [0, 5, 9, 11]) expect(again.symbolsAt(zoom)).toEqual(result.symbolsAt(zoom));
  });
});

describe("symbolise without clustering", () => {
  it("draws a marker for every record that is not drawn with its outline", () => {
    const records = sample(300, 100, 7);
    const result = symbolise(records, { cluster: false });
    for (const zoom of [0, 6, 12]) {
      const symbols = result.symbolsAt(zoom);
      expect(symbols.every((symbol) => symbol.kind === "marker")).toBe(true);
      expect(symbols.length).toBe(records.filter(({ id }) => result.outlineZoomOf(id) > zoom).length);
    }
  });
});

describe("symbolise at the antimeridian", () => {
  it("joins markers on either side of it", () => {
    const result: Symbolisation<string> = symbolise([
      { id: "east", geometry: { type: "Point", coordinates: [179.99, 0] } },
      { id: "west", geometry: { type: "Point", coordinates: [-179.99, 0] } },
    ]);
    const [only, ...rest] = result.symbolsAt(5);
    expect(rest).toHaveLength(0);
    expect(only?.kind).toBe("cluster");
    expect(Math.abs(Math.abs(only!.position[0]) - 180)).toBeLessThan(0.02);
  });
});

describe("symbolise at scale", () => {
  it("makes a single cluster of 70,000 records without exceeding the limit on call arguments", () => {
    const next = random(3);
    const records = Array.from({ length: 70000 }, (_, id) => ({
      id,
      geometry: { type: "Point", coordinates: [23 + next() * 0.01, 38 + next() * 0.01] } as Geometry,
    }));
    const [only, ...rest] = symbolise(records).symbolsAt(0);
    expect(rest).toHaveLength(0);
    expect(only?.kind === "cluster" && only.count).toBe(70000);
  });
});

describe("options", () => {
  it("refuses values that cannot be sizes or zoom levels", () => {
    expect(() => symbolise([], { outlinePx: -1 })).toThrow(RangeError);
    expect(() => symbolise([], { gapPx: Number.NaN })).toThrow(RangeError);
    expect(() => symbolise([], { clusterMaxZoom: 2.5 })).toThrow(RangeError);
  });

  it("leaves out records without a geometry", () => {
    const result = symbolise([
      { id: 1, geometry: null },
      { id: 2, geometry: { type: "Point", coordinates: [0, 0] } },
    ]);
    expect(result.symbolsAt(0).flatMap(idsOf)).toEqual([2]);
    expect(result.positionOf(1)).toBeUndefined();
  });
});
