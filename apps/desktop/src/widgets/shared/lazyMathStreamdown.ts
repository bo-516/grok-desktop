/**
 * Lazy entry for {@link MathStreamdownView} (KaTeX math Markdown).
 *
 * Purpose: keep `katex` + `@streamdown/math` + `katex.min.css` in their own
 * async chunk. Callers render plain Streamdown until hasMathDelimiters says a
 * message/document may contain math, then render this inside a `<Suspense>`
 * whose fallback is that same plain Streamdown — streaming text never blanks.
 *
 * Boundary: the first math render in an app session suspends once while the
 * chunk loads (local asset under Wails; React may hold the plain fallback for
 * up to its ~300 ms reveal throttle). Every later render resolves
 * synchronously because React.lazy caches the resolved module. A failed chunk
 * load surfaces through the nearest error boundary like any render error.
 */

import { lazy } from "react";

/**
 * React.lazy wrapper around MathStreamdownView. Only this dynamic import may
 * reference the module, otherwise KaTeX is pulled back into the main chunk.
 */
export const LazyMathStreamdownView = lazy(() =>
  import("./MathStreamdownView").then((m) => ({
    default: m.MathStreamdownView,
  })),
);
