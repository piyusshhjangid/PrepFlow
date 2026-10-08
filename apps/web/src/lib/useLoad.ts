import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/http';

export type Loaded<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'error'; message: string; code: string | null };

export const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';

/** Loads once (and again on `reload`), ignoring results that arrive after unmount. */
export function useLoad<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<Loaded<T>>({ kind: 'loading' });
  const mounted = useRef(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await fetchRef.current();
      if (mounted.current) setState({ kind: 'ready', data });
    } catch (error) {
      if (mounted.current)
        setState({
          kind: 'error',
          message: messageOf(error),
          code: error instanceof ApiError ? error.code : null,
        });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload, setState };
}
