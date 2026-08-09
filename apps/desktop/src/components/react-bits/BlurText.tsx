/**
 * React Bits BlurText — word/letter entrance with blur + opacity (motion).
 *
 * Purpose: empty-state headlines and other one-shot title moments.
 * Boundary: does not re-animate when `text` changes unless remounted by key.
 */

import { motion, type Transition } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import cs from "classnames";

export type BlurTextProps = {
  text: string;
  className?: string;
  /** Stagger between units in ms. */
  delay?: number;
  animateBy?: "words" | "letters";
  direction?: "top" | "bottom";
  threshold?: number;
  stepDuration?: number;
  onAnimationComplete?: () => void;
};

/**
 * Builds multi-step keyframes for motion.span.
 * @param from starting snapshot
 * @param steps intermediate + final snapshots
 */
function buildKeyframes(
  from: Record<string, string | number>,
  steps: Array<Record<string, string | number>>,
): Record<string, Array<string | number>> {
  const keys = new Set<string>([
    ...Object.keys(from),
    ...steps.flatMap((s) => Object.keys(s)),
  ]);
  const keyframes: Record<string, Array<string | number>> = {};
  for (const k of keys) {
    keyframes[k] = [from[k] ?? 0, ...steps.map((s) => s[k] ?? from[k] ?? 0)];
  }
  return keyframes;
}

/**
 * @param props text + animation options; empty text renders empty paragraph
 * @returns Animated paragraph of spans
 */
export function BlurText(props: BlurTextProps) {
  const {
    text,
    className,
    delay = 80,
    animateBy = "words",
    direction = "top",
    threshold = 0.1,
    stepDuration = 0.32,
    onAnimationComplete,
  } = props;
  const elements = useMemo(
    () => (animateBy === "words" ? text.split(" ") : text.split("")),
    [animateBy, text],
  );
  /** Stable React keys without using the map index as key (occurrence counters). */
  const keyedElements = useMemo(() => {
    const counts = new Map<string, number>();
    return elements.map((segment, index) => {
      const n = counts.get(segment) ?? 0;
      counts.set(segment, n + 1);
      return { segment, index, key: `${segment}#${n}` };
    });
  }, [elements]);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  const fromSnapshot = useMemo(
    () =>
      direction === "top"
        ? { filter: "blur(10px)", opacity: 0, y: -28 }
        : { filter: "blur(10px)", opacity: 0, y: 28 },
    [direction],
  );
  const toSnapshots = useMemo(
    () => [
      {
        filter: "blur(4px)",
        opacity: 0.55,
        y: direction === "top" ? 4 : -4,
      },
      { filter: "blur(0px)", opacity: 1, y: 0 },
    ],
    [direction],
  );
  const animateKeyframes = useMemo(
    () => buildKeyframes(fromSnapshot, toSnapshots),
    [fromSnapshot, toSnapshots],
  );
  const stepCount = toSnapshots.length + 1;
  const totalDuration = stepDuration * (stepCount - 1);
  const times = Array.from({ length: stepCount }, (_, i) =>
    stepCount === 1 ? 0 : i / (stepCount - 1),
  );

  return (
    <p ref={ref} className={cs("rb-blur-text", className)}>
      {keyedElements.map(({ segment, key, index }) => {
        const spanTransition: Transition = {
          duration: totalDuration,
          times,
          delay: (index * delay) / 1000,
        };
        return (
          <motion.span
            key={key}
            className="rb-blur-text-unit"
            initial={fromSnapshot}
            animate={inView ? animateKeyframes : fromSnapshot}
            transition={spanTransition}
            onAnimationComplete={
              index === keyedElements.length - 1
                ? onAnimationComplete
                : undefined
            }
          >
            {segment === " " ? "\u00A0" : segment}
            {animateBy === "words" && index < keyedElements.length - 1
              ? "\u00A0"
              : null}
          </motion.span>
        );
      })}
    </p>
  );
}
