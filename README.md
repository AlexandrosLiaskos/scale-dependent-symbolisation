# Scale-Dependent Symbolisation and Collision-Free Clustering of Map Features

[![Checks](https://github.com/AlexandrosLiaskos/scale-dependent-symbolisation/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexandrosLiaskos/scale-dependent-symbolisation/actions/workflows/ci.yml)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24460750.svg)](https://doi.org/10.5281/zenodo.24460750)
[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)

A web map of a research dataset usually holds features of very different sizes: points, small lines and polygons that
are invisible at a small map scale, and large ones that are clearly visible. This library decides, for every record and
every zoom level, in which single form the record is drawn:

- a **line or polygon is drawn with its outline** from the zoom level at which it is large enough on the screen to be
  seen, and **as a point marker** before that; it is never drawn in both forms at once;
- a **point** is always a point marker;
- point markers that would be too close to one another are grouped in **nested clusters**, and no marker or cluster is
  left touching another.

It has no dependencies and works with any web map library that uses the Web Mercator projection: MapLibre GL JS,
Mapbox GL JS, Leaflet and OpenLayers.

## Why

Two common practices break down with mixed datasets:

- Drawing every polygon and also a marker at its centre shows each small feature twice, and a large one with a marker
  in its middle.
- Switching from markers to outlines at one fixed zoom level makes small features vanish into specks of a few pixels,
  and keeps large features as dots long after their shape could be seen.

Distance-based clustering, in turn, joins markers within a fixed radius of a seed. The centre of a cluster then moves
towards its members, and a marker just beyond the radius can be left against the disc of the cluster. It also does not
know that a record leaves the markers once it is drawn with its outline.

## Example

[examples/maplibre.html](examples/maplibre.html) draws 600 points and 300 squares of many sizes with MapLibre GL JS.
Build the library (`npm run build`), serve the repository folder over HTTP and open the page.

## Installation

```sh
npm install scale-dependent-symbolisation
```

## Use with MapLibre GL JS

```js
import { symbolise } from "scale-dependent-symbolisation";

// `data` is a GeoJSON FeatureCollection whose features have unique ids.
const symbolisation = symbolise(data.features.map((feature) => ({ id: feature.id, geometry: feature.geometry })));

// Lines and polygons, each with the zoom level from which it is drawn with its outline.
const outlined = data.features
  .filter((feature) => Number.isFinite(symbolisation.outlineZoomOf(feature.id)))
  .map((feature) => ({ ...feature, properties: { ...feature.properties, outlineZoom: symbolisation.outlineZoomOf(feature.id) } }));
map.addSource("outlines", { type: "geojson", data: { type: "FeatureCollection", features: outlined } });
map.addLayer({
  id: "fills",
  type: "fill",
  source: "outlines",
  filter: [">=", ["zoom"], ["get", "outlineZoom"]],
  paint: { "fill-opacity": 0.4 },
});
map.addLayer({ id: "lines", type: "line", source: "outlines", filter: [">=", ["zoom"], ["get", "outlineZoom"]] });

// The point markers and clusters of the present zoom level.
map.addSource("symbols", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
map.addLayer({
  id: "markers",
  type: "circle",
  source: "symbols",
  filter: ["==", ["get", "kind"], "marker"],
  paint: { "circle-radius": 7, "circle-stroke-width": 2.5 },
});
map.addLayer({
  id: "clusters",
  type: "circle",
  source: "symbols",
  filter: ["==", ["get", "kind"], "cluster"],
  paint: { "circle-radius": ["step", ["get", "count"], 18, 10, 21, 100, 24] },
});

let level = -1;
function drawSymbols() {
  const zoom = Math.floor(map.getZoom());
  if (zoom === level) return;
  level = zoom;
  map.getSource("symbols").setData({
    type: "FeatureCollection",
    features: symbolisation.symbolsAt(zoom).map((symbol) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: symbol.position },
      properties: symbol.kind === "marker" ? { kind: "marker", id: symbol.id } : { kind: "cluster", count: symbol.count },
    })),
  });
}
map.on("load", drawSymbols);
map.on("zoom", drawSymbols);
```

MapLibre GL JS evaluates `["zoom"]` in a layer filter at the whole zoom level of the tile, which is the level that
`symbolsAt` uses, so the outline of a record and its marker are never shown together.

The radii used for the clusters must be those that the map draws: here the defaults, a marker of 7 px with a ring of
2.5 px (`markerRadiusPx: 9.5`) and cluster discs of 18, 21 and 24 px (`clusterRadiusPx`). Pass your own if your symbols
differ. For Leaflet and OpenLayers, whose zoom levels count 256-pixel tiles, pass `tileSize: 256`.

## Interface

### `symbolise(records, options?)`

`records` is an iterable of `{ id, geometry }`, where `geometry` is a GeoJSON geometry (or `null`, and the record is left
out). Ids must be unique. Returns a `Symbolisation`:

| Member              | Returns                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `symbolsAt(zoom)`   | The symbols to draw at a zoom level: `{ kind: "marker", id, position }` and `{ kind: "cluster", ids, count, position }`, with `position` as `[longitude, latitude]`. A fractional zoom is taken down to its whole level. The result of a level is computed once and kept. |
| `outlineZoomOf(id)` | The first whole zoom level at which the record is drawn with its outline; `Infinity` for a point, or for a shape too small to reach `outlinePx` by `maxZoom`.                                                                                                             |
| `positionOf(id)`    | The position of the record's point marker.                                                                                                                                                                                                                                |
| `options`           | The options in effect.                                                                                                                                                                                                                                                    |

### Options

| Option              | Default          | Meaning                                                                                                  |
| ------------------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `outlinePx`         | `24`             | The size on the screen, in pixels, from which a line or polygon is drawn with its outline.               |
| `cluster`           | `true`           | Whether point markers are grouped in clusters.                                                           |
| `clusterDistancePx` | `42`             | Markers closer than this are grouped.                                                                    |
| `gapPx`             | `6`              | The free space kept between any two symbols.                                                             |
| `markerRadiusPx`    | `9.5`            | The radius of a point marker on the screen, ring included.                                               |
| `clusterRadiusPx`   | `18`, `21`, `24` | A function giving the radius of the disc of a cluster of `n` records (below 10, below 100, 100 or more). |
| `clusterMaxZoom`    | `11`             | The highest zoom level at which clusters are formed.                                                     |
| `maxZoom`           | `22`             | The highest zoom level of the map.                                                                       |
| `tileSize`          | `512`            | The width of a tile in pixels: 512 for MapLibre GL JS and Mapbox GL JS, 256 for Leaflet and OpenLayers.  |

### `outlineZoom(geometry, { outlinePx, tileSize, maxZoom })` and `representativePoint(geometry)`

The two measures that `symbolise` uses, for use on their own.

## How it works

1. **Representative point.** A point stands at its own position. Any other geometry stands at the centre of the
   bounding box of all its positions. When the shape crosses the antimeridian, the box is taken across it.
2. **Outline zoom.** The size `s` of a polygon is the larger of the side of the square of its area and half its longest
   extent; the size of a line is half its longest extent. Both are measured in Web Mercator as a fraction of the width
   of the world, holes subtracted, across the antimeridian when the shape crosses it. A multi-part geometry takes the
   size of its largest part. The outline zoom is the first whole level `z` with `s · tileSize · 2^z ≥ outlinePx`.
3. **Clusters, level by level.** The levels are made from `clusterMaxZoom` down to 0. Each level starts from the symbols
   of the level above, together with the records that become point markers at it: those drawn with their outline one
   level up. Two symbols `a` and `b` are joined when they are closer on the screen than their reach,
   `max(clusterDistancePx, r(a) + r(b) + gapPx)`. The symbols lie in a grid of cells as wide as the longest reach, so
   only the eight cells around a symbol are searched. Larger symbols gather their neighbours first, and passes are
   repeated until no two symbols are within reach. A cluster stands at the centre of its records, weighted by their
   number. Distances are measured across the antimeridian.

The tests check these properties on 1,900 points and polygons of sizes from a thousandth of a degree to one degree,
around Greece and across the antimeridian, at every zoom level:

- every record is drawn in exactly one form: with its outline, as a marker, or within one cluster;
- every two symbols of a level are at least `gapPx` apart, edge to edge;
- every symbol of a level lies wholly within one symbol of the level below;
- the same records always give the same symbols.

Since distances on the screen only grow as the map is zoomed in, the symbols of a level stay clear of one another at
every zoom up to the next level.

## Performance

`symbolise` computes the clusters of every level at once. On a laptop with Node.js 24 it takes about 0.1 s for 10,000
points and 0.8 s for 100,000. Reading the symbols of a level afterwards takes a few milliseconds. When the records
change, for instance with a filter, call `symbolise` again with the remaining ones.

## Limitations

- The representative point is the centre of the bounding box. For a curved line or a ring-shaped polygon it can lie
  outside the shape.
- Beyond `clusterMaxZoom` markers are not grouped and can overlap.
- Markers and clusters are kept clear of one another, not of the outlines of other records, which they can cover.
- Sizes are measured in Web Mercator only.

## Citation

Liaskos, A. (2026). *Scale-Dependent Symbolisation and Collision-Free Clustering of Map Features* (Version 0.1.0)
[Computer software]. Zenodo. https://doi.org/10.5281/zenodo.24460750

The citation is also given in [CITATION.cff](CITATION.cff), which GitHub offers under "Cite this repository". Each
release is archived on Zenodo with its own DOI.

## Licence

Copyright © 2026 Alexandros Liaskos, National and Kapodistrian University of Athens.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General
Public License, version 3, as published by the Free Software Foundation ([LICENSE](LICENSE)). It is distributed in the
hope that it will be useful, but without any warranty; without even the implied warranty of merchantability or fitness
for a particular purpose.
