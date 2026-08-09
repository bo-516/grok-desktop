/**
 * Priority ladder for the composer status row — drives shipped resolveComposerStatus only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPOSER_STATUS_BRIDGE_DOWN,
  COMPOSER_STATUS_DEFAULT,
  COMPOSER_STATUS_LISTENING,
  resolveComposerStatus,
} from "@/widgets/composer/composerStatus";

describe("resolveComposerStatus", () => {
  it("priority 1: bridge down beats everything including listening and notices", () => {
    assert.deepEqual(
      resolveComposerStatus({
        connectionMode: "disconnected",
        dictating: true,
        notice: { text: "Send failed", tone: "warn" },
      }),
      { text: COMPOSER_STATUS_BRIDGE_DOWN, tone: "warn" },
    );
    assert.deepEqual(
      resolveComposerStatus({
        connectionMode: "connecting",
        dictating: false,
        notice: null,
      }),
      { text: COMPOSER_STATUS_BRIDGE_DOWN, tone: "warn" },
    );
  });

  it("priority 2: warn notice beats info notice, listening, and default", () => {
    assert.deepEqual(
      resolveComposerStatus({
        connectionMode: "live-bridge",
        dictating: true,
        notice: { text: "Dictation: mic denied", tone: "warn" },
      }),
      { text: "Dictation: mic denied", tone: "warn" },
    );
  });

  it("priority 3: info notice beats listening and default", () => {
    assert.deepEqual(
      resolveComposerStatus({
        connectionMode: "live-bridge",
        dictating: true,
        notice: { text: "Queued — will send after this turn finishes", tone: "info" },
      }),
      {
        text: "Queued — will send after this turn finishes",
        tone: "info",
      },
    );
  });

  it("priority 4: dictating shows the sole listening sentence", () => {
    assert.deepEqual(
      resolveComposerStatus({
        connectionMode: "live-bridge",
        dictating: true,
        notice: null,
      }),
      { text: COMPOSER_STATUS_LISTENING, tone: "info" },
    );
  });

  it("priority 5: default shortcuts when idle on live bridge", () => {
    assert.deepEqual(
      resolveComposerStatus({
        connectionMode: "live-bridge",
        dictating: false,
        notice: null,
      }),
      { text: COMPOSER_STATUS_DEFAULT, tone: "neutral" },
    );
  });

  it("empty notice text is ignored so lower priorities can win", () => {
    assert.deepEqual(
      resolveComposerStatus({
        connectionMode: "live-bridge",
        dictating: false,
        notice: { text: "", tone: "warn" },
      }),
      { text: COMPOSER_STATUS_DEFAULT, tone: "neutral" },
    );
  });

  it("warn beats info when both could apply (only one notice slot — warn wins ladder)", () => {
    // Channel holds one notice; warn tone is higher on the ladder than info.
    assert.deepEqual(
      resolveComposerStatus({
        connectionMode: "live-bridge",
        dictating: false,
        notice: { text: "Bridge not connected", tone: "warn" },
      }),
      { text: "Bridge not connected", tone: "warn" },
    );
    assert.notDeepEqual(
      resolveComposerStatus({
        connectionMode: "live-bridge",
        dictating: false,
        notice: { text: "Edit the prompt", tone: "info" },
      }).tone,
      "warn",
    );
  });
});
