/**
 * Minimal rehype safety for workspace document preview.
 *
 * Streamdown's default `rehype-harden` blocks relative paths (`./x.md`, `docs/a.md`)
 * and rewrites `./x` against the page origin — that breaks the in-drawer link matrix.
 * For disk docs we only strip dangerous schemes; relative targets stay intact so
 * PreviewDocWidget can resolve them against the open file path.
 *
 * No new runtime dependency: walks the HAST tree without unist-util-visit.
 */

/** Hast-like node shape produced by remark-rehype (only fields we touch). */
type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * True when a URL uses a scheme that must never navigate or load in the drawer.
 * `data:image/…` is allowed for images (handled separately); bare `data:` is not.
 * @param raw Href or img src string.
 */
function isDangerousScheme(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (t.startsWith("javascript:") || t.startsWith("vbscript:")) {
    return true;
  }
  if (t.startsWith("file:")) {
    return true;
  }
  // Non-image data URLs are not safe as link targets.
  if (t.startsWith("data:") && !t.startsWith("data:image/")) {
    return true;
  }
  return false;
}

/**
 * Visit every element node depth-first.
 * @param node Root or intermediate HAST node.
 * @param visit Callback for each element.
 */
function walkElements(
  node: HastNode,
  visit: (el: HastNode) => void,
): void {
  if (node.type === "element") {
    visit(node);
  }
  const kids = node.children;
  if (!Array.isArray(kids)) {
    return;
  }
  for (const child of kids) {
    walkElements(child, visit);
  }
}

/**
 * Rehype plugin: strip dangerous link/image schemes; keep relative workspace paths.
 * @returns Unified transformer for a HAST root.
 */
export function docRehypeSafety() {
  return (tree: HastNode) => {
    walkElements(tree, (node) => {
      const props = node.properties;
      if (!props) {
        return;
      }
      if (node.tagName === "a") {
        const href = props.href;
        if (typeof href === "string" && isDangerousScheme(href)) {
          delete props.href;
        }
      }
      if (node.tagName === "img") {
        const src = props.src;
        if (typeof src === "string" && isDangerousScheme(src)) {
          delete props.src;
        }
      }
    });
  };
}

/** Stable rehype plugin list for Streamdown static document mode. */
export const docRehypePlugins = [docRehypeSafety];
