/**
 * External URL open helpers: scheme allow-list + open path selection.
 * Node:test has no browser globals — stub window/location for open path tests.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  openExternalUrl,
  sanitizeExternalUrl,
} from "@/lib/openExternalUrl";

describe("sanitizeExternalUrl", () => {
  it("accepts http(s) with host and mailto", () => {
    assert.equal(
      sanitizeExternalUrl("https://useglass.ai/"),
      "https://useglass.ai/",
    );
    assert.equal(
      sanitizeExternalUrl("http://example.com/path?q=1"),
      "http://example.com/path?q=1",
    );
    assert.equal(
      sanitizeExternalUrl("mailto:hi@example.com"),
      "mailto:hi@example.com",
    );
  });

  it("rejects empty, relative, and dangerous schemes", () => {
    assert.equal(sanitizeExternalUrl(""), null);
    assert.equal(sanitizeExternalUrl("  "), null);
    assert.equal(sanitizeExternalUrl("/relative"), null);
    assert.equal(sanitizeExternalUrl("javascript:alert(1)"), null);
    assert.equal(sanitizeExternalUrl("data:text/html,hi"), null);
    assert.equal(sanitizeExternalUrl("file:///etc/passwd"), null);
    assert.equal(sanitizeExternalUrl("ftp://example.com"), null);
  });
});

describe("openExternalUrl", () => {
  /** Captured window.open calls for assertions. */
  let openCalls: unknown[][];
  /** Previous global window so we can restore after each test. */
  let prevWindow: unknown;

  beforeEach(() => {
    openCalls = [];
    prevWindow = (globalThis as { window?: unknown }).window;
    // Vite-dev-like host so Wails IPC path is skipped.
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          protocol: "http:",
          hostname: "localhost",
          origin: "http://localhost:5173",
        },
        open: (...args: unknown[]) => {
          openCalls.push(args);
          return {} as Window;
        },
      },
    });
  });

  afterEach(() => {
    if (prevWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: prevWindow,
      });
    }
  });

  it("returns false for rejected URLs without calling open", async () => {
    assert.equal(await openExternalUrl("javascript:void(0)"), false);
    assert.equal(openCalls.length, 0);
  });

  it("falls back to window.open outside Wails", async () => {
    assert.equal(await openExternalUrl("https://awel.dev"), true);
    assert.equal(openCalls.length, 1);
    assert.deepEqual(openCalls[0], [
      "https://awel.dev/",
      "_blank",
      "noopener,noreferrer",
    ]);
  });
});
