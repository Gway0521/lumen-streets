// A road graph can contain thousands of recursively connected edges. Transport
// flat identities across the worker boundary instead of deeply nested cycles.
export function packGraph(graph) {
  return {
    nodes: [...graph.nodes.values()].map(({ out, incoming, ...node }) => ({
      ...node,
      out: out.map((e) => e.id),
      incoming: incoming.map((e) => e.id),
    })),
    edges: graph.edges.map(({ from, to, ...edge }) => ({
      ...edge,
      from: from.id,
      to: to.id,
    })),
    valid: graph.valid.map((e) => e.id),
  };
}
export function unpackGraph(wire) {
  const nodes = new Map(
    wire.nodes.map((n) => [n.id, { ...n, out: [], incoming: [] }]),
  );
  const edges = wire.edges.map((e) => ({
    ...e,
    from: nodes.get(e.from),
    to: nodes.get(e.to),
  }));
  for (const e of edges) {
    e.from.out.push(e);
    e.to.incoming.push(e);
  }
  return {
    nodes,
    edges,
    valid: wire.valid.map((i) => edges[i]),
    signals: [...nodes.values()].filter((n) => n.signal),
  };
}
