import { describe, expect, it } from 'vitest';
import { topic } from '../test/factories';
import { clearState, initialState, loadState, reducer, saveState, STORAGE_KEY } from './store';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
};
const today = '2026-10-22';

describe('store', () => {
  it('starts a week before the exam by default', () => {
    expect(initialState(today).settings.examDate).toBe('2026-10-29');
  });
  it('round-trips through storage', () => {
    const s = memory();
    let state = initialState(today);
    state = reducer(state, { type: 'material', material: { text: 'notes', source: 'paste' } });
    state = reducer(state, { type: 'settings', patch: { goal: 'Physics' } });
    expect(saveState(s, state)).toBe(true);
    expect(loadState(s, today)).toEqual(state);
  });
  it('discards corrupt, tampered or wrong-version saved data', () => {
    const s = memory();
    for (const bad of [
      'not json',
      '{}',
      '{"version":2}',
      JSON.stringify({
        ...initialState(today),
        settings: { ...initialState(today).settings, examDate: 'tomorrow' },
      }),
    ]) {
      s.setItem(STORAGE_KEY, bad);
      expect(loadState(s, today)).toEqual(initialState(today));
    }
  });
  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('x');
      },
    };
    expect(loadState(broken, today)).toEqual(initialState(today));
    expect(saveState(broken, initialState(today))).toBe(false);
    expect(() => clearState(broken)).not.toThrow();
    expect(saveState(undefined, initialState(today))).toBe(false);
  });
  it('completes a task, then undoes it', () => {
    const task = {
      id: 'study:a:2026-10-22:1',
      kind: 'study' as const,
      topicId: 'a',
      date: today,
      minutes: 45,
    };
    let state = reducer(initialState(today), { type: 'complete', task, today });
    expect(state.progress.a).toEqual({ studiedMinutes: 45, lastStudiedOn: today, reviewsDone: 0 });
    expect(state.history).toHaveLength(1);
    state = reducer(state, { type: 'undo' });
    expect(state.progress).toEqual({});
    expect(reducer(state, { type: 'undo' })).toBe(state);
  });
  it('clamps edited minutes and keeps other topics untouched', () => {
    let state = reducer(initialState(today), {
      type: 'analyzed',
      topics: [topic({ id: 'a' }), topic({ id: 'b', minutes: 60 })],
      report: null as never,
    });
    state = reducer(state, { type: 'topic', id: 'a', patch: { minutes: 3 } });
    expect(state.topics[0]!.minutes).toBe(15);
    expect(state.topics[1]!.minutes).toBe(60);
  });
  it('reset clears work but keeps the chosen model', () => {
    let state = reducer(initialState(today), {
      type: 'settings',
      patch: { model: 'gemma4:e2b', goal: 'x' },
    });
    state = reducer(state, { type: 'reset', today });
    expect(state.settings.model).toBe('gemma4:e2b');
    expect(state.settings.goal).toBe('');
  });
});
