/**
 * Render-count measurement for a 200-turn session while the last answer streams.
 *
 * Before: every chunk rebuilds render units and the memoized row sees a new
 * wrapper, so every row renders again (the pre-reuse cost).
 * After: reuse keeps settled wrappers, so only the live row renders.
 *
 * happy-dom supplies the document. IntersectionObserver is stubbed so settled
 * fences stay deferred and this test measures React render, not Shiki.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { after, describe, it } from "node:test";
import { Window } from "happy-dom";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import { reuseTimelineRenderUnits } from "@/lib/timelineRenderReuse";
import {
  isTurnLive,
  type TimelineRenderUnitWithTurns,
} from "@/lib/turnGrouping";
import {
  appendAgentChunk,
  buildLongSession,
  LONG_SESSION_TURNS,
} from "../../helpers/longTimelineFixture";

register(new URL("../../helpers/cssHooks.mjs", import.meta.url));

/** Tail chunks applied while status stays streaming. */
const CHUNKS = 8;

type RowCounts = {
  /** Renders of rows that are not the live turn. */
  settled: number;
  /** Renders of the streaming turn. */
  live: number;
};

/**
 * Copy one happy-dom global onto `globalThis`.
 * Node 26 exposes `navigator` as a getter-only property, so a plain assign
 * throws. A refused write is skipped; the test does not need that global.
 * @param host Process global object.
 * @param key Global name to replace.
 * @param value Happy-dom value. Undefined leaves the host unchanged.
 * @returns True when the host accepted the write and restore must undo it.
 */
function tryAssignGlobal(host: Record<string, unknown>, key: string, value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  try {
    host[key] = value;
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a happy-dom window on the globals React and the row hook read.
 * Restores only the keys that were actually written. A missing global is set
 * to undefined on restore rather than left pointing at the closed window.
 */
function installDom(): () => void {
  const win = new Window({ url: "http://127.0.0.1/" });
  const host = globalThis as unknown as Record<string, unknown>;
  const winRecord = win as unknown as Record<string, unknown>;
  const keys = [
    "window",
    "document",
    "HTMLElement",
    "Element",
    "Node",
    "DocumentFragment",
    "MutationObserver",
    "IntersectionObserver",
    "ResizeObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "DOMParser",
  ] as const;
  const saved: Record<string, unknown> = {};
  /** Keys whose assignment succeeded. Getter-only host props stay untouched. */
  const assigned: string[] = [];
  for (const key of keys) {
    saved[key] = host[key];
    if (tryAssignGlobal(host, key, winRecord[key])) {
      assigned.push(key);
    }
  }
  host.IS_REACT_ACT_ENVIRONMENT = true;

  /** Never reports intersection, so settled rows stay highlight-deferred. */
  class SilentObserver {
    /** Observe is a no-op; the test does not scroll. */
    observe(): void {}
    /** Detach is a no-op. */
    unobserve(): void {}
    /** Disconnect is a no-op. */
    disconnect(): void {}
    /** No pending records. */
    takeRecords(): [] {
      return [];
    }
  }
  host.IntersectionObserver = SilentObserver;

  const proto = win.HTMLElement.prototype as unknown as {
    getBoundingClientRect: () => {
      top: number;
      left: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    };
  };
  const originalRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function rect(this: { classList?: { contains: (name: string) => boolean } }) {
    if (this.classList?.contains("timeline")) {
      return { top: 0, left: 0, right: 800, bottom: 640, width: 800, height: 640 };
    }
    return { top: 4000, left: 0, right: 800, bottom: 4240, width: 800, height: 240 };
  };

  return () => {
    proto.getBoundingClientRect = originalRect;
    for (const key of assigned) {
      host[key] = saved[key];
    }
    delete host.IS_REACT_ACT_ENVIRONMENT;
    win.close();
  };
}

const restoreDom = installDom();
after(restoreDom);

/**
 * Props for one TimelineView paint. Units are either freshly built or reused.
 * @param timeline Current items.
 * @param toolCalls Stable card map.
 * @param units Render units for this paint.
 */
function viewProps(
  timeline: ReturnType<typeof buildLongSession>["timeline"],
  toolCalls: ReturnType<typeof buildLongSession>["toolCalls"],
  units: TimelineRenderUnitWithTurns[],
) {
  return {
    timeline,
    toolCalls,
    status: "streaming" as const,
    units,
    seededUnitKeys: new Set(
      units.map((unit) => (unit.type === "item" ? unit.item.id : unit.id)),
    ),
    isRestoring: false,
    isEmpty: false,
    scrollRef: { current: null },
    handleScroll: () => undefined,
    isTurnLive,
    wrapUpIndex: -1,
    wrapUpText: "",
  };
}

describe("long timeline streaming renders", () => {
  it("settled rows do not re-render while the last turn streams", async () => {
    const { act, createElement: reactCreate } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { TimelineView } = await import("@/widgets/timeline/TimelineView");
    const { setTimelineUnitRowRenderProbe } = await import(
      "@/widgets/timeline/timelineRowRenderProbe"
    );

    const session = buildLongSession(LONG_SESSION_TURNS);
    const counts: RowCounts = { settled: 0, live: 0 };
    setTimelineUnitRowRenderProbe((_key, live) => {
      if (live) {
        counts.live += 1;
      } else {
        counts.settled += 1;
      }
    });

    /**
     * Paint `chunks` tail updates. `reuse` selects the shipped path.
     * @param reuse True to keep settled wrappers.
     */
    async function run(reuse: boolean): Promise<{ settled: number; live: number; ms: number }> {
      counts.settled = 0;
      counts.live = 0;
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      let timeline = session.timeline;
      let previous = buildTimelineRenderUnits(timeline, session.toolCalls);
      await act(async () => {
        root.render(reactCreate(TimelineView, viewProps(timeline, session.toolCalls, previous)));
      });
      counts.settled = 0;
      counts.live = 0;
      const started = performance.now();
      for (let chunk = 0; chunk < CHUNKS; chunk += 1) {
        timeline = appendAgentChunk(timeline, ` tick${chunk}`);
        const built = buildTimelineRenderUnits(timeline, session.toolCalls);
        const units = reuse ? reuseTimelineRenderUnits(previous, built) : built;
        previous = units;
        await act(async () => {
          root.render(reactCreate(TimelineView, viewProps(timeline, session.toolCalls, units)));
        });
      }
      const ms = performance.now() - started;
      const result = { settled: counts.settled, live: counts.live, ms };
      await act(async () => {
        root.unmount();
      });
      container.remove();
      return result;
    }

    try {
      const before = await run(false);
      const after = await run(true);
      console.log(
        `[timeline-long-session] turns=${LONG_SESSION_TURNS} chunks=${CHUNKS} ` +
          `row renders settled ${before.settled} → ${after.settled}, ` +
          `live ${before.live} → ${after.live}, ` +
          `ms ${before.ms.toFixed(1)} → ${after.ms.toFixed(1)}`,
      );
      assert.ok(before.settled > LONG_SESSION_TURNS, "baseline should redraw settled rows");
      assert.equal(after.settled, 0, "settled rows must not render on a tail chunk");
      assert.equal(after.live, CHUNKS, "the live row renders once per chunk");
      assert.ok(
        after.ms < before.ms,
        `expected the reused path to be faster (${before.ms} → ${after.ms})`,
      );
    } finally {
      setTimelineUnitRowRenderProbe(null);
    }
  });
});
