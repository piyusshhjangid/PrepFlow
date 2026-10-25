import { useCallback, useEffect, useState } from 'react';
import type { ModelCheck } from '../ai/ollama';
import type { RuntimeFactory } from './runtime';

export type ModelState = 'checking' | ModelCheck;

/** Asks the runtime whether it is up and whether the chosen model is installed; re-asks when the model changes. */
export function useModelCheck(factory: RuntimeFactory, model: string) {
  const [state, setState] = useState<ModelState>('checking');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState('checking');
    const timer = setTimeout(() => {
      factory(model.trim() || 'x')
        .check()
        .then(
          (r) => live && setState(r),
          () => live && setState({ reachable: false, installed: false, models: [] }),
        );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [factory, model, nonce]);
  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  return { state, recheck };
}
