/**
 * The prerequisite graph. Edges run prerequisite -> dependent. The model's prerequisite lists are
 * suggestions: unknown names, self references and cycles are all possible, so the graph is
 * sanitized before the planner relies on it.
 *
 * CYCLE STRATEGY (documented in docs/planning.md): in any cycle at least one edge points
 * "backwards" against the order in which the material presents the topics (a prerequisite listed
 * AFTER its dependent). Those are the least-supported claims, so they are removed first, the
 * farthest-backward one first, until the graph is a DAG. Ties break on ids, so the repair is
 * deterministic. Every removal is reported.
 */
export interface GraphTopic {
  id: string;
  order: number;
  prerequisiteIds: readonly string[];
}

export interface Edge {
  /** The prerequisite. */
  from: string;
  /** The dependent. */
  to: string;
}

export interface CycleBreak {
  removed: Edge;
  /** Topics that formed the cycle, in document order. */
  members: string[];
}

export interface DependencyGraph {
  /** Topic ids in document order. */
  ids: string[];
  prerequisites: Map<string, string[]>;
  dependents: Map<string, string[]>;
  edgeCount: number;
  /** Topics with no prerequisites and no dependents. They are planned purely on priority. */
  orphans: string[];
  cyclesBroken: CycleBreak[];
  /** Prerequisite references to topics that do not exist. */
  unknownReferences: { topicId: string; reference: string }[];
  selfReferences: string[];
  /** 0 for topics without prerequisites, otherwise 1 + the deepest prerequisite. */
  depth: Map<string, number>;
  directDependents: Map<string, number>;
  transitiveDependents: Map<string, number>;
}

const edgeKey = (e: Edge) => `${e.from}\u0000${e.to}`;

/** Strongly connected components with more than one node (Tarjan). Deterministic given sorted input. */
function cyclicComponents(ids: readonly string[], adjacency: Map<string, string[]>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) result.push(component);
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return result;
}

export function buildDependencyGraph(topics: readonly GraphTopic[]): DependencyGraph {
  const sorted = [...topics].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ids = sorted.map((t) => t.id);
  const known = new Set(ids);
  const order = new Map(sorted.map((t) => [t.id, t.order]));

  const unknownReferences: DependencyGraph['unknownReferences'] = [];
  const selfReferences: string[] = [];
  const edges = new Map<string, Edge>();
  for (const topic of sorted) {
    for (const reference of topic.prerequisiteIds) {
      if (!known.has(reference)) {
        unknownReferences.push({ topicId: topic.id, reference });
      } else if (reference === topic.id) {
        selfReferences.push(topic.id);
      } else {
        const edge = { from: reference, to: topic.id };
        edges.set(edgeKey(edge), edge);
      }
    }
  }

  const adjacencyOf = () => {
    const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const e of [...edges.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b))))
      (adjacency.get(e.from) as string[]).push(e.to);
    return adjacency;
  };

  // ---- break cycles
  const cyclesBroken: CycleBreak[] = [];
  for (;;) {
    const components = cyclicComponents(ids, adjacencyOf());
    if (components.length === 0) break;
    // One removal per component per round, then re-check (a component may hold several cycles).
    components.sort(
      (a, b) =>
        Math.min(...a.map((i) => order.get(i) as number)) -
        Math.min(...b.map((i) => order.get(i) as number)),
    );
    for (const component of components) {
      const members = new Set(component);
      const inside = [...edges.values()].filter((e) => members.has(e.from) && members.has(e.to));
      const backwardness = (e: Edge) => (order.get(e.from) as number) - (order.get(e.to) as number);
      // Largest backward distance first; if (impossibly) none is backward, the largest value still orders deterministically.
      inside.sort(
        (a, b) => backwardness(b) - backwardness(a) || edgeKey(a).localeCompare(edgeKey(b)),
      );
      const removed = inside[0] as Edge;
      edges.delete(edgeKey(removed));
      cyclesBroken.push({
        removed,
        members: [...members].sort((a, b) => (order.get(a) as number) - (order.get(b) as number)),
      });
    }
  }

  // ---- final structures
  const prerequisites = new Map<string, string[]>(ids.map((id) => [id, []]));
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of [...edges.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))) {
    (prerequisites.get(e.to) as string[]).push(e.from);
    (dependents.get(e.from) as string[]).push(e.to);
  }

  const graph: DependencyGraph = {
    ids,
    prerequisites,
    dependents,
    edgeCount: edges.size,
    orphans: ids.filter(
      (id) =>
        (prerequisites.get(id) as string[]).length === 0 &&
        (dependents.get(id) as string[]).length === 0,
    ),
    cyclesBroken,
    unknownReferences,
    selfReferences,
    depth: new Map(),
    directDependents: new Map(),
    transitiveDependents: new Map(),
  };

  // depth + transitive dependents over a topological order (the graph is a DAG now)
  const topo = topologicalOrder(
    graph,
    (a, b) => (order.get(a) as number) - (order.get(b) as number),
  );
  for (const id of topo) {
    const pre = prerequisites.get(id) as string[];
    graph.depth.set(
      id,
      pre.length === 0 ? 0 : 1 + Math.max(...pre.map((p) => graph.depth.get(p) as number)),
    );
  }
  const below = new Map<string, Set<string>>();
  for (const id of [...topo].reverse()) {
    const set = new Set<string>();
    for (const d of dependents.get(id) as string[]) {
      set.add(d);
      for (const x of below.get(d) as Set<string>) set.add(x);
    }
    below.set(id, set);
    graph.directDependents.set(id, (dependents.get(id) as string[]).length);
    graph.transitiveDependents.set(id, set.size);
  }
  return graph;
}

/**
 * A topological order (prerequisites first). Among topics that are ready at the same time the one
 * `compare` ranks first goes first, so the order is fully determined by the graph and the comparator.
 */
export function topologicalOrder(
  graph: Pick<DependencyGraph, 'ids' | 'prerequisites' | 'dependents'>,
  compare: (a: string, b: string) => number,
): string[] {
  const remaining = new Map<string, number>(
    graph.ids.map((id) => [id, (graph.prerequisites.get(id) as string[]).length]),
  );
  const ready = graph.ids.filter((id) => remaining.get(id) === 0);
  const out: string[] = [];
  while (ready.length > 0) {
    let best = 0;
    for (let i = 1; i < ready.length; i += 1)
      if (compare(ready[i] as string, ready[best] as string) < 0) best = i;
    const [next] = ready.splice(best, 1) as [string];
    out.push(next);
    for (const d of graph.dependents.get(next) as string[]) {
      const left = (remaining.get(d) as number) - 1;
      remaining.set(d, left);
      if (left === 0) ready.push(d);
    }
  }
  return out;
}

/** All prerequisites of `id`, directly or indirectly (not including `id`). */
export function ancestorsOf(graph: Pick<DependencyGraph, 'prerequisites'>, id: string): string[] {
  const seen = new Set<string>();
  const stack = [...(graph.prerequisites.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(graph.prerequisites.get(next) ?? []));
  }
  return [...seen];
}
