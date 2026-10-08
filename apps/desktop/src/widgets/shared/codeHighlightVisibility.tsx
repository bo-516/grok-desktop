/**
 * Tells a fenced code block whether Shiki should run.
 *
 * Preview and other surfaces leave the default `"immediate"` and highlight
 * as soon as the fence mounts. The timeline row provider switches a settled
 * off-screen row to `"deferred"` so tokenizing waits until the row is near
 * the scroller, then `"near"` once it is. Missing the provider (or passing
 * the wrong value) only changes when colors appear — the source text still
 * renders.
 */

import { createContext, type ReactNode } from "react";

/**
 * When to tokenize a fence.
 * - `immediate` — no timeline scope; highlight on mount (preview, docs).
 * - `near` — timeline row is inside the prefetch band; highlight now.
 * - `deferred` — timeline row is off-screen; keep the plain source text.
 */
export type CodeHighlightVisibility = "immediate" | "near" | "deferred";

/**
 * Default is immediate so a fence rendered outside the timeline (preview,
 * document) never waits on a scroll observer it does not have.
 */
export const CodeHighlightVisibilityContext =
  createContext<CodeHighlightVisibility>("immediate");

export type CodeHighlightVisibilityProviderProps = {
  /** Visibility for every fence under this provider. */
  visibility: CodeHighlightVisibility;
  /** Fence subtree. Omitted children render nothing. */
  children?: ReactNode;
};

/**
 * Scope highlight timing to one timeline row.
 * The value is a string primitive, so a parent re-render does not wake
 * fences whose mode did not change.
 * @param props Visibility plus the row body.
 */
export function CodeHighlightVisibilityProvider(
  props: CodeHighlightVisibilityProviderProps,
) {
  const { visibility, children } = props;
  return (
    <CodeHighlightVisibilityContext.Provider value={visibility}>
      {children}
    </CodeHighlightVisibilityContext.Provider>
  );
}
