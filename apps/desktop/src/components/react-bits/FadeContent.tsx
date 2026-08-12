/**
 * React Bits–inspired FadeContent (no GSAP).
 * Soft entrance for timeline rows / empty states — content remains readable if
 * reveal never fires (default opacity 1). Honors prefers-reduced-motion.
 *
 * Purpose: progressive-enhancement fade; never gate visibility solely on animation.
 * Boundary: presentation only; does not own open/close state of parents.
 */

import cs from "classnames";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type FadeContentProps = {
  children: ReactNode;
  /** Extra class names on the wrapper. */
  className?: string;
  /** When true, starts blurred until visible. */
  blur?: boolean;
  /** Delay before starting the enter transition (ms). */
  delayMs?: number;
  /** Transition duration (ms). */
  durationMs?: number;
  /** Intersection ratio 0–1 to trigger (default 0.08). */
  threshold?: number;
  /** Skip IntersectionObserver and show immediately. */
  immediate?: boolean;
  /** Optional inline layout only (no colors). */
  style?: CSSProperties;
};

/**
 * Whether the user prefers reduced motion (SSR-safe: false when window missing).
 * @returns true when matchMedia('(prefers-reduced-motion: reduce)') matches
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * @param props children + animation knobs; missing children renders empty box
 * @returns Wrapper that fades in when in view, or shows final state under reduced motion
 */
export function FadeContent(props: FadeContentProps) {
  const {
    children,
    className,
    blur = false,
    delayMs = 0,
    durationMs = 480,
    threshold = 0.08,
    immediate = false,
    style,
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = prefersReducedMotion();
  /**
   * Latched at mount: an entrance that has already started must be allowed to
   * finish. `immediate` flipping false → true mid-transition drops the duration
   * to 0ms, which snaps the row to its end state — visible as a jump on the
   * message you just sent, because promoting a New chat draft to a real session
   * id reseeds the timeline entrance baseline while that bubble is still fading
   * in. Mounting with `immediate` already true still skips the animation.
   */
  const skipAnimRef = useRef(immediate || reduceMotion);
  const skipAnim = skipAnimRef.current;
  const [visible, setVisible] = useState(skipAnim);

  useEffect(() => {
    if (skipAnim) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) {
      // Mount race: keep content readable rather than stuck pending.
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    // Fallback: if never intersecting (hidden tab / print), reveal after a beat.
    const fallback = window.setTimeout(() => {
      setVisible(true);
      observer.disconnect();
    }, 1200);
    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, [skipAnim, threshold]);

  return (
    <div
      ref={ref}
      className={cs("rb-fade", className, {
        "rb-fade-pending": !visible && !skipAnim,
        "rb-fade-visible": visible,
        "rb-fade-blur": blur && !skipAnim,
      })}
      style={{
        ...style,
        transitionDelay: skipAnim ? "0ms" : `${delayMs}ms`,
        transitionDuration: skipAnim ? "0ms" : `${durationMs}ms`,
      }}
    >
      {children}
    </div>
  );
}
