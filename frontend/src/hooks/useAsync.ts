import { useCallback, useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "success"; data: T };

/**
 * Runs `load` whenever `deps` change; `reload` runs it again. When deps change or the component unmounts, the
 * previous request's signal is aborted and its response (or error) is ignored, so a stale result never shows.
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal).then(
      (data) => active && setState({ status: "success", data }),
      (error) => active && setState({ status: "error", error }),
    );
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { ...state, reload };
}
