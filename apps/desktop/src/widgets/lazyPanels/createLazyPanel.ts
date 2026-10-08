/**
 * Preloadable React.lazy entry for a code-split panel.
 *
 * Purpose: one memoized dynamic import shared by three consumers —
 * React.lazy (render path), idle warm-up and intent prefetch (preload path) —
 * plus an observable `ready` flag so a wrapper can mount the panel only once
 * its chunk is evaluated (see useLazyPanelMount).
 *
 * Boundary: `preload()` never rejects (warm-up must not raise unhandled
 * rejections); a failed load clears the memo so the next preload or render
 * retries. React.lazy itself caches a rejection for good, so a render-time
 * failure surfaces through the nearest error boundary like any render error.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** Load-state surface shared by every lazy panel, independent of its props. */
export type LazyPanelLoader = {
  /**
   * Start (or join) the chunk load. Resolves once the module is evaluated or
   * the load failed — never rejects. Safe to call any number of times.
   */
  preload: () => Promise<void>;
  /** True once the module has loaded at least once (sticky). */
  isReady: () => boolean;
  /**
   * Subscribe to the ready flag (useSyncExternalStore contract).
   * @returns Unsubscribe function.
   */
  subscribe: (listener: () => void) => () => void;
};

/** A lazy panel: the React.lazy component plus its loader. */
export type LazyPanel<P extends object> = LazyPanelLoader & {
  /** React.lazy component; must render under a `<Suspense>` boundary. */
  Component: LazyExoticComponent<ComponentType<P>>;
};

/**
 * Wrap a dynamic import of a panel component in a preloadable lazy entry.
 * @param load Dynamic import resolving to the panel component. Called at most
 *   once per successful load; must import the feature's public entry (its
 *   `index.ts`) so the widget-index convention survives code splitting.
 * @returns Lazy component + preload / ready / subscribe helpers.
 */
export function createLazyPanel<P extends object>(
  load: () => Promise<ComponentType<P>>,
): LazyPanel<P> {
  /** Ready listeners (React subscriptions). */
  const listeners = new Set<() => void>();
  /** Mutable memo: in-flight / settled import and the sticky ready flag. */
  const state: {
    pending: Promise<{ default: ComponentType<P> }> | null;
    ready: boolean;
  } = { pending: null, ready: false };

  /**
   * Shared module promise in React.lazy's `{ default }` shape.
   * @returns The memoized import; rejects when the chunk fails to load.
   */
  const loadModule = (): Promise<{ default: ComponentType<P> }> => {
    if (!state.pending) {
      state.pending = load().then(
        (component) => {
          state.ready = true;
          for (const listener of listeners) {
            listener();
          }
          return { default: component };
        },
        (error: unknown) => {
          // Forget the failed attempt so a later preload / render retries.
          state.pending = null;
          throw error;
        },
      );
    }
    return state.pending;
  };

  return {
    Component: lazy(loadModule),
    preload: () =>
      loadModule().then(
        () => undefined,
        () => undefined,
      ),
    isReady: () => state.ready,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
