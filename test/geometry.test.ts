import { describe, expect, it } from "vitest";
import { outlineZoom, representativePoint, type Geometry } from "../src/index.js";

const OPTIONS = { outlinePx: 24, tileSize: 512, maxZoom: 22 };

/** A square of `side` degrees with its south-west corner at (lng, lat). */
const square = (lng: number, lat: number, side: number): number[][][] => [
  [
    [lng, lat],
    [lng + side, lat],
    [lng + side, lat + side],
    [lng, lat + side],
    [lng, lat],
  ],
];

describe("outlineZoom", () => {
  it("is the first zoom level at which a polygon measures the outline size on the screen", () => {
    // A square of 1° at the equator is 512/360 = 1.42 px wide at zoom 0: 22.8 px at zoom 4, 45.5 px at zoom 5.
    expect(outlineZoom({ type: "Polygon", coordinates: square(0, 0, 1) }, OPTIONS)).toBe(5);
    expect(outlineZoom({ type: "Polygon", coordinates: square(0, 0, 1) }, { ...OPTIONS, outlinePx: 22 })).toBe(4);
  });

  it("follows the tile size of the map library", () => {
    expect(outlineZoom({ type: "Polygon", coordinates: square(0, 0, 1) }, { ...OPTIONS, tileSize: 256 })).toBe(6);
  });

  it("measures a line by half its longest extent", () => {
    // A line of 2° along the equator: 2.84 px at zoom 0, half of it 1.42 px, as the side of the 1° square.
    const line: Geometry = {
      type: "LineString",
      coordinates: [
        [10, 0],
        [12, 0],
      ],
    };
    expect(outlineZoom(line, OPTIONS)).toBe(5);
  });

  it("is never reached by points", () => {
    expect(outlineZoom({ type: "Point", coordinates: [23.7, 37.9] }, OPTIONS)).toBe(Infinity);
    expect(
      outlineZoom(
        {
          type: "MultiPoint",
          coordinates: [
            [0, 0],
            [50, 50],
          ],
        },
        OPTIONS,
      ),
    ).toBe(Infinity);
  });

  it("is never reached by a polygon without extent, nor by one too small for the highest zoom level", () => {
    const point = [
      [
        [1, 1],
        [1, 1],
        [1, 1],
        [1, 1],
      ],
    ];
    expect(outlineZoom({ type: "Polygon", coordinates: point }, OPTIONS)).toBe(Infinity);
    expect(outlineZoom({ type: "Polygon", coordinates: square(0, 0, 1e-9) }, OPTIONS)).toBe(Infinity);
  });

  it("takes the largest part of a multi-part geometry, so scattered islands wait for their own size", () => {
    const islands: Geometry = { type: "MultiPolygon", coordinates: [square(0, 0, 1), square(100, 0, 1)] };
    expect(outlineZoom(islands, OPTIONS)).toBe(5);
  });

  it("takes the polygon of a collection, not its point", () => {
    const collection: Geometry = {
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [-60, 10] },
        { type: "Polygon", coordinates: square(0, 0, 1) },
      ],
    };
    expect(outlineZoom(collection, OPTIONS)).toBe(5);
  });

  it("subtracts holes from the area of a polygon", () => {
    // A frame: a 4° square with a 3.8° hole. Its area is small, so half its extent (2°) decides: 2.84 px at zoom 0.
    const frame: Geometry = { type: "Polygon", coordinates: [...square(0, 0, 4), ...square(0.1, 0.1, 3.8)] };
    expect(outlineZoom(frame, OPTIONS)).toBe(4);
  });

  it("measures a polygon that crosses the antimeridian by its own width, not the width of the world", () => {
    // 1° wide, from 179.5° E to 179.5° W; near the equator, as the 1° square.
    const crossing: Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [179.5, 0],
          [-179.5, 0],
          [-179.5, 1],
          [179.5, 1],
          [179.5, 0],
        ],
      ],
    };
    expect(outlineZoom(crossing, OPTIONS)).toBe(5);
  });
});

describe("representativePoint", () => {
  it("is the position of a point", () => {
    expect(representativePoint({ type: "Point", coordinates: [23.7, 37.9, 120] })).toEqual([23.7, 37.9]);
  });

  it("is the centre of the bounding box of a shape", () => {
    expect(representativePoint({ type: "Polygon", coordinates: square(20, 30, 2) })).toEqual([21, 31]);
  });

  it("is on the antimeridian for a shape split there", () => {
    const split: Geometry = { type: "MultiPolygon", coordinates: [square(179, -17, 1), square(-180, -17, 1)] };
    const [lng, lat] = representativePoint(split) ?? [NaN, NaN];
    expect(Math.abs(Math.abs(lng) - 180)).toBeLessThan(1e-9);
    expect(lat).toBeCloseTo(-16.5);
  });

  it("is null for a missing or empty geometry", () => {
    expect(representativePoint(null)).toBeNull();
    expect(representativePoint({ type: "MultiPolygon", coordinates: [] })).toBeNull();
    expect(representativePoint({ type: "GeometryCollection", geometries: [] })).toBeNull();
  });
});
