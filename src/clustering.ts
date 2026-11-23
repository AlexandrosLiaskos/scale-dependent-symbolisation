/**
 * Collision-free grouping of point markers at one zoom level.
 *
 * Symbols closer than their reach are joined into a cluster at their weighted centre. The reach of two symbols is the
 * cluster distance, or the sum of their radii and the gap when that is larger, so that no marker or cluster is left
 * touching another. Larger symbols gather their neighbours first, and passes are repeated until no two symbols are
 * within reach. Distances are measured across the antimeridian.
 */

/** A point marker (one record) or a cluster (several), at its position as fractions of the world (Web Mercator). */
export interface Node<Id> {
  readonly x: number;
  readonly y: number;
  readonly ids: readonly Id[];
  /** The exact position of a single record, kept so that a marker stands exactly on its record. */
  readonly position?: readonly [number, number];
}

export interface JoinOptions {
  readonly tileSize: number;
  readonly clusterDistancePx: number;
  readonly gapPx: number;
  readonly markerRadiusPx: number;
  readonly clusterRadiusPx: (records: number) => number;
}

/** The radius on the screen of a symbol standing for `records` records. */
export const radiusOf = (records: number, options: JoinOptions): number =>
  records === 1 ? options.markerRadiusPx : options.clusterRadiusPx(records);

/** Joins the symbols of zoom level `zoom` until no two are within reach of each other. */
export function join<Id>(nodes: readonly Node<Id>[], zoom: number, options: JoinOptions): Node<Id>[] {
  const world = options.tileSize * 2 ** zoom;
  let current = [...nodes];
  // Each pass that joins anything leaves fewer symbols, so there are at most as many passes as symbols.
  for (let pass = 0; pass <= nodes.length; pass++) {
    const next = joinOnce(current, world, options);
    if (next.length === current.length) return next;
    current = next;
  }
  return current;
}

function joinOnce<Id>(nodes: readonly Node<Id>[], world: number, options: JoinOptions): Node<Id>[] {
  let largest = 0;
  for (const node of nodes) largest = Math.max(largest, radiusOf(node.ids.length, options));
  // A cell is as wide as the longest reach, so the neighbours of a symbol are in its cell or the eight around it.
  const cell = Math.max(options.clusterDistancePx, 2 * largest + options.gapPx);
  const across = Math.max(1, Math.ceil(world / cell));
  const symbols = nodes.map((node, index) => ({
    node,
    index,
    px: node.x * world,
    py: node.y * world,
    cx: Math.min(across - 1, Math.floor((node.x * world) / cell)),
    cy: Math.min(across - 1, Math.max(0, Math.floor((node.y * world) / cell))),
    taken: false,
  }));
  const cells = new Map<number, (typeof symbols)[number][]>();
  for (const symbol of symbols) {
    const key = symbol.cy * across + symbol.cx;
    const list = cells.get(key);
    if (list) list.push(symbol);
    else cells.set(key, [symbol]);
  }
  const order = [...symbols].sort((a, b) => b.node.ids.length - a.node.ids.length || a.index - b.index);
  const next: Node<Id>[] = [];
  for (const seed of order) {
    if (seed.taken) continue;
    seed.taken = true;
    const seedRadius = radiusOf(seed.node.ids.length, options);
    let members: { node: Node<Id>; px: number; py: number }[] | null = null;
    // The columns on either side wrap around the antimeridian; in a world narrower than three cells a column that
    // is both a neighbour and the seed's own is visited once.
    const west = (seed.cx - 1 + across) % across;
    const east = (seed.cx + 1) % across;
    for (let step = 0; step < 3; step++) {
      const cx = step === 0 ? seed.cx : step === 1 ? west : east;
      if ((step === 1 && west === seed.cx) || (step === 2 && (east === seed.cx || east === west))) continue;
      for (let cy = seed.cy - 1; cy <= seed.cy + 1; cy++) {
        if (cy < 0 || cy >= across) continue;
        const cell = cells.get(cy * across + cx);
        if (!cell) continue;
        for (const other of cell) {
          if (other.taken) continue;
          let dx = other.px - seed.px;
          if (dx > world / 2) dx -= world;
          else if (dx < -world / 2) dx += world;
          const dy = other.py - seed.py;
          const reach = Math.max(options.clusterDistancePx, seedRadius + radiusOf(other.node.ids.length, options) + options.gapPx);
          if (dx * dx + dy * dy >= reach * reach) continue;
          other.taken = true;
          (members ??= []).push({ node: other.node, px: seed.px + dx, py: other.py });
        }
      }
    }
    if (!members) {
      next.push(seed.node);
      continue;
    }
    members.push({ node: seed.node, px: seed.px, py: seed.py });
    let sumX = 0,
      sumY = 0;
    const ids: Id[] = [];
    for (const member of members) {
      const records = member.node.ids.length;
      sumX += member.px * records;
      sumY += member.py * records;
      // One by one: spreading a large cluster into push() would exceed the engine's limit on call arguments.
      for (const id of member.node.ids) ids.push(id);
    }
    const x = sumX / ids.length / world;
    next.push({ x: x - Math.floor(x), y: sumY / ids.length / world, ids });
  }
  return next;
}
