# Changelog

All notable changes to this library are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-23

### Added

- `symbolise(records, options)`: for every record and zoom level, a single form, an outline or a point marker,
  and nested, collision-free clusters of the point markers, with `symbolsAt`, `outlineZoomOf` and `positionOf`.
- `outlineZoom(geometry, options)`: the first zoom level at which a line or polygon reaches a size on the screen,
  measured by its largest part and across the antimeridian.
- `representativePoint(geometry)`: the position of a point, or the centre of the bounding box of a shape, taken across
  the antimeridian.
- Tests of the guarantees on points and polygons around Greece and across the antimeridian, and of a cluster of 70,000
  records.
