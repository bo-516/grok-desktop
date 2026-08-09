/**
 * React Bits ClickSpark — radial line burst on click (canvas overlay).
 * Stroke color is read from `--color-text-primary` (defineColor token).
 *
 * Purpose: wrap send / primary action zones for tactile feedback.
 * Boundary: decorative only; does not intercept children events beyond bubble.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type MouseEvent,
} from "react";
import cs from "classnames";

export type ClickSparkProps = {
  children: ReactNode;
  className?: string;
  sparkCount?: number;
  sparkSize?: number;
  sparkRadius?: number;
  durationMs?: number;
};

type Spark = {
  x: number;
  y: number;
  angle: number;
  startTime: number;
};

/**
 * @param props children under canvas; sparkCount ≤ 0 disables drawing
 * @returns Relative wrapper with non-interactive canvas overlay
 */
export function ClickSpark(props: ClickSparkProps) {
  const {
    children,
    className,
    sparkCount = 8,
    sparkSize = 9,
    sparkRadius = 16,
    durationMs = 380,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);
  const colorRef = useRef("currentColor");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }
    const resize = () => {
      const { width, height } = parent.getBoundingClientRect();
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    resize();
    const csStyle = getComputedStyle(parent);
    colorRef.current =
      csStyle.getPropertyValue("--color-text-primary").trim() ||
      csStyle.color ||
      "currentColor";
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    let frame = 0;
    const easeOut = (t: number) => t * (2 - t);
    const draw = (timestamp: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sparksRef.current = sparksRef.current.filter((spark) => {
        const elapsed = timestamp - spark.startTime;
        if (elapsed >= durationMs) {
          return false;
        }
        const progress = easeOut(elapsed / durationMs);
        const distance = progress * sparkRadius;
        const lineLength = sparkSize * (1 - progress);
        const x1 = spark.x + distance * Math.cos(spark.angle);
        const y1 = spark.y + distance * Math.sin(spark.angle);
        const x2 =
          spark.x + (distance + lineLength) * Math.cos(spark.angle);
        const y2 =
          spark.y + (distance + lineLength) * Math.sin(spark.angle);
        ctx.strokeStyle = colorRef.current;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return true;
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, sparkRadius, sparkSize]);

  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || sparkCount <= 0) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const now = performance.now();
      const next: Spark[] = Array.from({ length: sparkCount }, (_, i) => ({
        x,
        y,
        angle: (2 * Math.PI * i) / sparkCount,
        startTime: now,
      }));
      sparksRef.current.push(...next);
    },
    [sparkCount],
  );

  return (
    <div className={cs("rb-click-spark", className)} onClick={onClick}>
      <canvas ref={canvasRef} className="rb-click-spark-canvas" aria-hidden />
      {children}
    </div>
  );
}
