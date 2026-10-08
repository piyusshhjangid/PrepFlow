import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, topologicalOrder, ancestorsOf } from './graph.js';

const g = (spec: Record<string, string[]>) =>
  buildDependencyGraph(
    Object.entries(spec).map(([id, prerequisiteIds], order) => ({ id, order, prerequisiteIds })),
  );
const order = (graph: ReturnType<typeof g>) =>
  topologicalOrder(graph, (a, b) => a.localeCompare(b));

describe('dependency graph', () => {
  it('builds a valid DAG with depth and dependent counts', () => {
    const graph = g({ a: [], b: ['a'], c: ['b'], d: ['a'] });
    expect(graph.cyclesBroken).toEqual([]);
    expect(graph.edgeCount).toBe(3);
    expect(graph.depth.get('a')).toBe(0);
    expect(graph.depth.get('c')).toBe(2);
    expect(graph.directDependents.get('a')).toBe(2);
    expect(graph.transitiveDependents.get('a')).toBe(3);
    expect(ancestorsOf(graph, 'c').sort()).toEqual(['a', 'b']);
  });

  it('orders prerequisites before dependents', () => {
    const graph = g({ c: ['b'], b: ['a'], a: [] });
    const o = order(graph);
    expect(o.indexOf('a')).toBeLessThan(o.indexOf('b'));
    expect(o.indexOf('b')).toBeLessThan(o.indexOf('c'));
  });

  it('identifies orphans (no prerequisites and no dependents)', () => {
    const graph = g({ a: [], b: ['a'], lonely: [] });
    expect(graph.orphans).toEqual(['lonely']);
  });

  it('ignores unknown references and self references, and reports them', () => {
    const graph = g({ a: ['a', 'ghost'], b: ['a'] });
    expect(graph.selfReferences).toEqual(['a']);
    expect(graph.unknownReferences).toEqual([{ topicId: 'a', reference: 'ghost' }]);
    expect(graph.edgeCount).toBe(1);
  });

  it('detects a 3-cycle, removes exactly the backward edge, and keeps a valid DAG', () => {
    // document order a, b, c; claims: a needs c (backward), b needs a, c needs b
    const graph = g({ a: ['c'], b: ['a'], c: ['b'] });
    expect(graph.cyclesBroken).toHaveLength(1);
    expect(graph.cyclesBroken[0]?.removed).toEqual({ from: 'c', to: 'a' });
    expect(graph.edgeCount).toBe(2);
    expect(order(graph)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a 2-cycle and a self-contained second cycle independently', () => {
    const graph = g({ a: ['b'], b: ['a'], c: ['d'], d: ['c'] });
    expect(graph.cyclesBroken).toHaveLength(2);
    expect(order(graph)).toHaveLength(4);
  });

  it('handles a component with several overlapping cycles', () => {
    const graph = g({ a: ['b', 'c'], b: ['c'], c: ['a', 'b'] });
    expect(order(graph)).toHaveLength(3); // fully acyclic afterwards
    expect(graph.cyclesBroken.length).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic regardless of the input order of the array', () => {
    const spec = { a: ['c'], b: ['a'], c: ['b'] };
    const forward = buildDependencyGraph(
      Object.entries(spec).map(([id, p], order) => ({ id, order, prerequisiteIds: p })),
    );
    const shuffled = buildDependencyGraph(
      Object.entries(spec)
        .reverse()
        .map(([id, p]) => ({ id, order: { a: 0, b: 1, c: 2 }[id] as number, prerequisiteIds: p })),
    );
    expect(shuffled.cyclesBroken).toEqual(forward.cyclesBroken);
  });

  it('handles an empty graph and a single topic', () => {
    expect(g({}).ids).toEqual([]);
    expect(g({ a: [] }).orphans).toEqual(['a']);
  });

  it('copes with a 500-topic chain quickly', () => {
    const spec: Record<string, string[]> = {};
    for (let i = 0; i < 500; i += 1)
      spec[`t${String(i).padStart(3, '0')}`] =
        i === 0 ? [] : [`t${String(i - 1).padStart(3, '0')}`];
    const started = Date.now();
    const graph = g(spec);
    expect(graph.depth.get('t499')).toBe(499);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
