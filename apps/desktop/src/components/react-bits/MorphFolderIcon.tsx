/**
 * Morphing folder glyph (MorphSVG-style) for the session rail: interpolates
 * the `d` attribute between the lucide "folder" and "folder-open" outlines
 * instead of crossfading two stacked icons.
 *
 * Implementation: both outlines are hand-authored with an IDENTICAL command
 * sequence (M C L C L C L C L C L C L C Z), so motion's complex-value mixer
 * interpolates every number channel position-wise — same technique as GSAP
 * MorphSVG's point matching, without the plugin. Two subpaths morph in
 * lockstep:
 *   - `body`: the full closed-folder silhouette ↔ the open silhouette (back
 *     outline + front-face right/bottom edges). The closed outline pads the
 *     back-edge/corner segments the open state needs with degenerate
 *     zero-length segments collapsed at the top-right corner, so the corner
 *     "splits" into flap corner + back corner while opening.
 *   - `flap`: the open icon's interior flap line. In the closed state all of
 *     its points sit collinear ON the body's top edge (y=6), so it overdraws
 *     the existing stroke invisibly; opening peels it off the edge into the
 *     forward-leaning trapezoid edge.
 * Boundary: pure presentation — the caller owns the open/closed state.
 * Honors prefers-reduced-motion (snap, no interpolation).
 */

import { motion, type Transition } from "motion/react";

export type MorphFolderIconProps = {
  /** True draws the open-folder silhouette; false the closed folder. */
  open: boolean;
  className?: string;
  /** Lucide-style stroke width on the 24px viewBox grid (default 1.75). */
  strokeWidth?: number;
};

/**
 * Body silhouette — closed folder. Segments 4 (L) and 5 (C) are degenerate
 * at (20,6): the open body needs an extra back-edge + corner that the closed
 * outline does not have, so they collapse into the top-right corner point
 * and grow out of it during the morph. Ends Z → (20,20) bottom edge.
 */
const BODY_CLOSED =
  "M 20 20 C 21.1 20 22 19.1 22 18 L 22 8 C 22 6.9 21.1 6 20 6 L 20 6 C 20 6 20 6 20 6 L 12.1 6 C 11.4 6 10.9 5.6 10.41 5.1 L 9.6 3.9 C 9.3 3.45 8.7 3 7.93 3 L 4 3 C 2.9 3 2 3.9 2 5 L 2 18 C 2 19.1 2.9 20 4 20 Z";

/**
 * Body silhouette — open folder. Same command sequence as BODY_CLOSED:
 * flap bottom-right corner → flap right slant → flap top-right corner →
 * back right edge up → back top-right corner → back top edge → tab notch →
 * tab top → top-left corner → left edge → bottom-left corner → Z closes
 * along the shared bottom edge to (18.45,20).
 */
const BODY_OPEN =
  "M 18.45 20 C 19.35 20 20.1 19.4 20.4 18.5 L 21.94 12.5 C 22.35 11.45 21.55 10.25 20 10 L 20 8 C 20 6.9 19.1 6 18 6 L 12.07 6 C 11.3 6 10.75 5.55 10.4 5.1 L 9.59 3.9 C 9.3 3.45 8.65 3 7.9 3 L 4 3 C 2.9 3 2 3.9 2 5 L 2 18 C 2 19.1 2.9 20 4 20 Z";

/**
 * Flap stroke — hidden state: a flat sliver lying exactly on the body's top
 * edge (y=6, x 12.5→20). Identical stroke overdraws identical stroke, so the
 * closed glyph is pixel-identical to lucide "folder". Its last point (20,6)
 * shares keyframes with the body corner end, keeping the two paths glued
 * through the whole morph.
 */
const FLAP_CLOSED = "M 12.5 6 L 13.4 6 C 14.5 6 15.5 6 16.5 6 L 20 6";

/**
 * Flap stroke — open state: the front face's left edge + top edge
 * (6,14 → 7.5,11.1 → corner → 9.24,10 → 20,10). Bottom-left tip floats off
 * the body edge, matching the lucide "folder-open" silhouette; round caps
 * keep the free ends soft.
 */
const FLAP_OPEN = "M 6 14 L 7.5 11.1 C 7.7 10.55 8.35 10 9.24 10 L 20 10";

/**
 * Duration-based spring: snappy like the 120ms chrome transitions but with a
 * hint of overshoot so the flap lands with weight rather than a linear slide.
 */
const MORPH_TRANSITION: Transition = {
  type: "spring",
  duration: 0.3,
  bounce: 0.12,
};

/**
 * Reduced-motion transition: duration 0 snaps `d` to the target instantly.
 */
const SNAP_TRANSITION: Transition = { duration: 0 };

/**
 * Whether the user prefers reduced motion (SSR-safe: false when window missing).
 * Read per render like FadeContent does — the icon is decorative chrome, so a
 * mid-session OS change takes effect on the next state toggle, which is fine.
 * @returns true when matchMedia('(prefers-reduced-motion: reduce)') matches
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * @param props `open` drives the morph direction; className owns size/color
 *   (width/height + text color on the svg, drawn with currentColor).
 *   Missing `open` renders the closed folder.
 * @returns Inline 24×24 lucide-grid SVG with two morphing strokes.
 */
export function MorphFolderIcon(props: MorphFolderIconProps) {
  const { open, className, strokeWidth = 1.75 } = props;
  const transition = prefersReducedMotion() ? SNAP_TRANSITION : MORPH_TRANSITION;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Silhouette: closed outline ↔ open back + front-face edges. */}
      <motion.path
        initial={false}
        animate={{ d: open ? BODY_OPEN : BODY_CLOSED }}
        transition={transition}
      />
      {/* Interior flap edge: peels off the top edge into the trapezoid. */}
      <motion.path
        initial={false}
        animate={{ d: open ? FLAP_OPEN : FLAP_CLOSED }}
        transition={transition}
      />
    </svg>
  );
}
