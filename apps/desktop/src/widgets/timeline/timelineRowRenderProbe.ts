/**
 * Optional render counter for the long-session perf test.
 *
 * Production leaves the probe null, so {@link noteTimelineUnitRowRender} is
 * a single null check. The test installs a probe and counts calls: a memo
 * bail-out never reaches the note, which is the measurement we want.
 * Not a store and not a DOM write.
 */

/** One committed render of a timeline row (memo miss). */
export type TimelineUnitRowRenderProbe = (unitKey: string, live: boolean) => void;

/** Installed probe, or null when nobody is measuring. */
let renderProbe: TimelineUnitRowRenderProbe | null = null;

/**
 * Install or clear the row render probe.
 * @param next Probe to call from each row render, or null to stop counting.
 *   A probe that throws will break the row render — tests must not throw.
 */
export function setTimelineUnitRowRenderProbe(
  next: TimelineUnitRowRenderProbe | null,
): void {
  renderProbe = next;
}

/**
 * Record that a timeline row function ran.
 * No-op when no probe is installed. Called at the start of the row render,
 * so a skipped memo row does not record.
 * @param unitKey Stable row key ({@link timelineRenderUnitKey}).
 * @param live True when this row is the streaming turn. Settled rows pass false.
 */
export function noteTimelineUnitRowRender(unitKey: string, live: boolean): void {
  if (renderProbe !== null) {
    renderProbe(unitKey, live);
  }
}
