/**
 * ESM loader hook: CSS side-effect imports become empty modules in Node tests.
 * Needed so SubagentTranscriptView → TimelineView can load (KaTeX CSS).
 */

/**
 * Intercept `.css` URLs before tsx/node throw ERR_UNKNOWN_FILE_EXTENSION.
 * @param url Absolute module URL.
 * @param context Loader context (unused).
 * @param nextLoad Next hook in the chain.
 */
export async function load(url, context, nextLoad) {
  const path = String(url).split("?")[0] ?? "";
  if (path.endsWith(".css")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default {};\n",
    };
  }
  return nextLoad(url, context);
}
