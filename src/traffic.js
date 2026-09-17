import { roadWidth } from "./shared/roads.js";
const drivable = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "residential",
  "unclassified",
  "service",
  "living_street",
]);
export function canDrive(tags) {
  return (
    drivable.has(tags.highway) &&
    tags.area !== "yes" &&
    tags.tunnel !== "yes" &&
    !["no", "private"].includes(tags.access) &&
    tags.motor_vehicle !== "no" &&
    tags.motorcar !== "no"
  );
}
// Relative demand per metre: through roads carry the night, side streets stay quiet.
// Link roads inherit their parent class even when the artwork draws them narrowly.
export function roadDemand(edge) {
  const type = edge.type.replace(/_link$/, "");
  return ({ motorway: 8, trunk: 7, primary: 6, secondary: 4.5, tertiary: 2.8,
    unclassified: 1.1, residential: 1, living_street: 0.55, service: 0.35 })[type] || 1;
}
export function buildGraph(city) {
  const ways = city.roads.filter(
      (w) => canDrive(w.tags) && w.nodes?.length === w.points.length,
    ),
    neighbors = new Map(),
    positions = new Map();
  function link(a, b) {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a).add(b);
  }
  for (const w of ways)
    for (let i = 0; i < w.nodes.length; i++) {
      positions.set(w.nodes[i], w.points[i]);
      if (i) {
        link(w.nodes[i - 1], w.nodes[i]);
        link(w.nodes[i], w.nodes[i - 1]);
      }
    }
  const nodes = new Map(),
    edges = [];
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        p: positions.get(id),
        out: [],
        incoming: [],
        signal: false,
        offset: 0,
      });
    return nodes.get(id);
  };
  function add(points, from, to, tags, wayId) {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++)
      cumulative.push(
        cumulative[i - 1] +
          Math.hypot(
            points[i][0] - points[i - 1][0],
            points[i][1] - points[i - 1][1],
          ),
      );
    const length = cumulative.at(-1);
    if (length < 1) return;
    const a = points.at(-2),
      b = points.at(-1),
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      m = Math.hypot(dx, dy) || 1;
    const e = {
      id: edges.length,
      from: node(from),
      to: node(to),
      points,
      cumulative,
      length,
      width: roadWidth(tags),
      type: tags.highway,
      wayId,
      axis: Math.abs(dx) > Math.abs(dy) ? 0 : 1,
      tangent: [dx / m, dy / m],
      lane: ["yes", "1", "true", "-1"].includes(tags.oneway)
        ? 0
        : Math.min(3, roadWidth(tags) * 0.22),
    };
    edges.push(e);
    e.from.out.push(e);
    e.to.incoming.push(e);
  }
  for (const w of ways) {
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (i !== w.nodes.length - 1 && neighbors.get(w.nodes[i]).size === 2)
        continue;
      const points = w.points.slice(start, i + 1),
        from = w.nodes[start],
        to = w.nodes[i];
      if (w.tags.oneway !== "-1") add(points, from, to, w.tags, w.id);
      if (
        w.tags.oneway === "-1" ||
        (!["yes", "1", "true"].includes(w.tags.oneway) &&
          (w.tags.junction !== "roundabout" || w.tags.oneway === "no"))
      )
        add(points.toReversed(), to, from, w.tags, w.id);
      start = i;
    }
  }
  const bounds = city.bounds;
  const valid = edges.filter((e) =>
    e.points.some(
      (p) =>
        p[0] > bounds[0] + 20 &&
        p[0] < bounds[2] - 20 &&
        p[1] > bounds[1] + 20 &&
        p[1] < bounds[3] - 20,
    ),
  );
  for (const n of nodes.values()) {
    const all = [...n.out, ...n.incoming],
      dirs = new Set(all.map((e) => (e.from === n ? e.to.id : e.from.id)));
    n.signal =
      dirs.size >= 3 &&
      all.some((e) => e.width >= 14) &&
      n.incoming.some((e) => e.axis === 0) &&
      n.incoming.some((e) => e.axis === 1);
    n.offset =
      (((Math.round(n.p[0] / 80) * 17 + Math.round(n.p[1] / 80) * 13) % 32) +
        32) %
      32;
  }
  const signals = [...nodes.values()].filter((n) => n.signal);
  return { nodes, edges, valid, signals };
}
export function green(edge, time) {
  if (!edge.to.signal) return true;
  const phase = (time + edge.to.offset) % 32;
  return edge.axis === 0 ? phase < 13 : phase >= 16 && phase < 29;
}
export function sample(edge, distance) {
  const d = Math.max(0, Math.min(edge.length, distance));
  let i = 1;
  while (i < edge.cumulative.length - 1 && edge.cumulative[i] < d) i++;
  const a = edge.points[i - 1],
    b = edge.points[i],
    len = edge.cumulative[i] - edge.cumulative[i - 1],
    t = len ? (d - edge.cumulative[i - 1]) / len : 0,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    m = Math.hypot(dx, dy) || 1;
  return {
    x: a[0] + dx * t - (dy / m) * edge.lane,
    y: a[1] + dy * t + (dx / m) * edge.lane,
    angle: Math.atan2(dy, dx),
  };
}
export function chooseNext(edge, rng, occupancy) {
  let options = edge.to.out.filter((e) => e.to !== edge.from);
  if (!options.length) return null;
  const weights = options.map((e) => {
    const a = e.points[0],
      b = e.points[1],
      l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
      dot =
        ((b[0] - a[0]) * edge.tangent[0] + (b[1] - a[1]) * edge.tangent[1]) / l;
    const occupied = (occupancy?.get(e.id)?.length || 0) * 12 / e.length;
    return (Math.max(0.15, 1 + dot * 2) + (e.width >= 14 ? 0.8 : 0)) *
      Math.sqrt(roadDemand(e)) / (1 + 12 * occupied * occupied);
  });
  let pick = rng() * weights.reduce((a, b) => a + b, 0);
  return options.find((_, i) => (pick -= weights[i]) <= 0) || options.at(-1);
}
export class Traffic {
  constructor(graph, seed = 29) {
    this.graph = graph;
    // Same Mulberry32 sequence as the artwork, with an explicit checkpoint state.
    this.randomState = seed >>> 0;
    this.rng = () => {
      this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
      let t = Math.imul(this.randomState ^ (this.randomState >>> 15), 1 | this.randomState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    this.cars = [];
    this.time = 0;
    this.serial = 0;
    this.totalWeight = 0;
    this.spawnEdges = graph.valid
      .filter((e) => e.length > 20)
      .map((e) => ({
        edge: e,
        weight: (this.totalWeight += e.length * roadDemand(e)),
      }));
  }
  create() {
    // A busy arterial may have no room. Try another weighted edge instead of
    // placing overlapping cars after a fixed number of position guesses.
    for (let attempt = 0; attempt < 12; attempt++) {
      const pick = this.rng() * this.totalWeight;
      const e = this.spawnEdges.find(x => x.weight >= pick)?.edge;
      if (!e) return null;
      const bus = e.width >= 14 && this.rng() < 0.055;
      const blocked = this.cars.filter(c => c.edge === e).map(c => {
        const gap = Math.max(bus ? 13 : 10, c.length + 3);
        return [Math.max(0, c.s - gap), Math.min(e.length, c.s + gap)];
      }).sort((a,b) => a[0] - b[0]);
      const free = []; let cursor = 0;
      for (const [left,right] of blocked) {
        if (left > cursor) free.push([cursor,left]);
        cursor = Math.max(cursor,right);
      }
      if (cursor < e.length) free.push([cursor,e.length]);
      let position = this.rng() * free.reduce((sum,[a,b]) => sum+b-a,0);
      const interval = free.find(([a,b]) => (position -= b-a) <= 0);
      if (!interval) continue;
      return {
        id: this.serial++, edge: e, next: chooseNext(e, this.rng),
        s: interval[1] + position, speed: 0,
        maxSpeed: (e.width >= 14 ? 9 : 5) + this.rng() * 5,
        length: bus ? 10 : 4.4, bus, age: 0, stopped: 0,
      };
    }
    return null;
  }
  snapshot() {
    return {
      time: this.time, serial: this.serial, randomState: this.randomState,
      cars: this.cars.map(c => ({
        id: c.id, edge: c.edge.id, next: c.next?.id ?? null,
        s: c.s, speed: c.speed, maxSpeed: c.maxSpeed, length: c.length,
        bus: c.bus, age: c.age, stopped: c.stopped,
      })),
    };
  }
  restore(snapshot) {
    const cars = snapshot.cars.map(c => {
      const edge = this.graph.edges[c.edge], next = c.next === null ? null : this.graph.edges[c.next];
      if (!edge || c.s > edge.length || (c.next !== null && (!next || next.from !== edge.to))) {
        throw new Error('Invalid simulation edge in scene recipe');
      }
      return { ...c, edge, next };
    });
    this.cars = cars;
    this.time = snapshot.time;
    this.serial = snapshot.serial;
    this.randomState = snapshot.randomState;
  }
  setCount(count) {
    while (this.cars.length < count) {
      const c = this.create();
      if (!c) break;
      this.cars.push(c);
    }
    if (this.cars.length > count) this.cars.length = count;
  }
  update(dt) {
    this.time += dt;
    const buckets = new Map();
    for (const c of this.cars) {
      if (!buckets.has(c.edge.id)) buckets.set(c.edge.id, []);
      buckets.get(c.edge.id).push(c);
    }
    for (const list of buckets.values())
      list.sort((a, b) => b.s - a.s || a.id - b.id);
    for (const list of buckets.values())
      for (let index = 0; index < list.length; index++) {
        const c = list[index];
        c.age += dt;
        let gap = Infinity;
        const leader = list[index - 1];
        if (leader) gap = leader.s - c.s - leader.length;
        if (c.next) {
          const nextList = buckets.get(c.next.id);
          if (nextList?.length) {
            const first = nextList.at(-1);
            gap = Math.min(gap, c.edge.length - c.s + first.s - first.length);
          }
        }
        if (!green(c.edge, this.time))
          gap = Math.min(
            gap,
            c.edge.length -
              c.s -
              Math.min(c.edge.length * 0.4, Math.max(8, c.edge.width * 0.55)),
          );
        const desired = Math.min(c.maxSpeed, Math.max(0, (gap - 3) * 0.65));
        c.speed += Math.max(-8 * dt, Math.min(2.4 * dt, desired - c.speed));
        c.speed = Math.max(0, c.speed);
        const step = Math.min(c.speed * dt, Math.max(0, gap - 2));
        c.s += step;
        c.stopped = c.speed < 0.3 ? c.stopped + dt : 0;
        if (c.s >= c.edge.length) {
          if (c.next) {
            c.s -= c.edge.length;
            c.edge = c.next;
            c.next = chooseNext(c.edge, this.rng, buckets);
            c.maxSpeed = c.edge.width >= 14 ? Math.max(c.maxSpeed, 11) : Math.min(c.maxSpeed, 8);
          } else {
            const fresh = this.create();
            if (fresh) Object.assign(c, fresh);
            else { c.s = c.edge.length; c.speed = 0; }
          }
        }
        // Deadlock recovery is a fading respawn, not a claim of full traffic physics.
        if (c.stopped > 100) {
          const fresh = this.create();
          if (fresh) Object.assign(c, fresh);
        }
      }
  }
}
