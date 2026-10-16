import { useCallback, useEffect, useState, type DependencyList } from "react";

const sameDeps = (a: DependencyList, b: DependencyList) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

type State<T> = { for: DependencyList; data: T | null; error: unknown };

/**
 * Data a component loads from the API. `data` is null until the answer for the current `deps`
 * arrives: other `deps` (another book, another club) show null again, never the previous item.
 * `reload()` and changes of `reloadOn` (e.g. a version bumped by a server event) fetch again and
 * keep showing the data meanwhile. When a request fails `error` is set and `data` becomes
 * `fallback` if one is given, else stays as it was. Answers to a request that was superseded,
 * or that arrive after the component is gone, are ignored.
 */
export function useApi<T>(load: () => Promise<T>, deps: DependencyList, opts: { fallback?: T; reloadOn?: DependencyList } = {}) {
  const [state, setState] = useState<State<T>>({ for: deps, data: null, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ for: deps, data, error: null }),
      (error) =>
        live && setState((s) => ({ for: deps, data: opts.fallback !== undefined ? opts.fallback : sameDeps(s.for, deps) ? s.data : null, error })),
    );
    return () => {
      live = false;
    };
    // `load` and `opts` are new on every render: `deps` and `reloadOn` say when to fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ...(opts.reloadOn ?? []), version]);

  const current = sameDeps(state.for, deps);
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    /** Fetches again ("Try again" also clears the error meanwhile). */
    reload: useCallback(() => {
      setState((s) => ({ ...s, error: null }));
      setVersion((v) => v + 1);
    }, []),
    /** Changes the data shown (an optimistic update); `update` gets null while loading. */
    setData: useCallback((update: (data: T | null) => T | null) => setState((s) => ({ ...s, data: update(s.data) })), []),
  };
}
