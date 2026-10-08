/**
 * createLazyPanel: one memoized import shared by React.lazy and preload.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLazyPanel } from "@/widgets/lazyPanels/createLazyPanel";

/** Minimal panel component stand-in. */
function FakePanel(_props: { open: boolean }) {
  return null;
}

describe("createLazyPanel", () => {
  it("loads once however many times preload is called", async () => {
    let calls = 0;
    const panel = createLazyPanel(() => {
      calls += 1;
      return Promise.resolve(FakePanel);
    });
    assert.equal(panel.isReady(), false);
    await Promise.all([panel.preload(), panel.preload()]);
    await panel.preload();
    assert.equal(calls, 1);
    assert.equal(panel.isReady(), true);
  });

  it("notifies subscribers once ready and honors unsubscribe", async () => {
    const panel = createLazyPanel(() => Promise.resolve(FakePanel));
    let kept = 0;
    let dropped = 0;
    panel.subscribe(() => {
      kept += 1;
    });
    const unsubscribe = panel.subscribe(() => {
      dropped += 1;
    });
    unsubscribe();
    await panel.preload();
    assert.equal(kept, 1);
    assert.equal(dropped, 0);
  });

  it("never rejects from preload and retries after a failed load", async () => {
    let calls = 0;
    const panel = createLazyPanel(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("chunk failed"))
        : Promise.resolve(FakePanel);
    });
    await panel.preload();
    assert.equal(panel.isReady(), false);
    await panel.preload();
    assert.equal(calls, 2);
    assert.equal(panel.isReady(), true);
  });

  it("exposes a React.lazy component", () => {
    const panel = createLazyPanel(() => Promise.resolve(FakePanel));
    const lazyType = Symbol.for("react.lazy");
    assert.equal(
      (panel.Component as unknown as { $$typeof: symbol }).$$typeof,
      lazyType,
    );
  });
});
