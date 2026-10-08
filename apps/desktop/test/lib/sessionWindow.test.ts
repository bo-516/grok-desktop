/**
 * URL-param boot and open-in-window planning.
 * The shell's Go tests cover the HTTP opener; these cover the decisions
 * the UI makes before it asks.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SESSION_WINDOW_PATH,
  decideBootOpen,
  formatSessionWindowTitle,
  isSessionWindowId,
  openSessionInNewWindow,
  pushNativeWindowTitle,
  readBootSessionId,
  resolveSessionWindowTarget,
  sessionWindowPath,
  sessionWindowShortcutLabel,
} from "@/lib/sessionWindow";

const UUID = "019ff5e1-f8e1-7970-bee3-4b3a2e04eec2";

describe("sessionWindow", () => {
  it("reads a session query and rejects unsafe ids", () => {
    assert.equal(readBootSessionId(`?session=${UUID}`), UUID);
    assert.equal(readBootSessionId(`session=${UUID}`), UUID);
    assert.equal(readBootSessionId(""), null);
    assert.equal(readBootSessionId("?session=../etc/passwd"), null);
    assert.equal(readBootSessionId("?session=has%20space"), null);
    assert.equal(isSessionWindowId("fixture-session-0001"), true);
    assert.equal(isSessionWindowId(""), false);
  });

  it("builds the same path the shell navigates to", () => {
    assert.equal(sessionWindowPath(UUID), `/?session=${UUID}`);
    assert.equal(sessionWindowPath("fixture-session-0001"), "/?session=fixture-session-0001");
    assert.equal(sessionWindowPath("nope/id"), null);
    assert.equal(SESSION_WINDOW_PATH, "/__grok_desktop_window");
  });

  it("pins boot to the URL session and does not steal the newest chat", () => {
    assert.equal(
      decideBootOpen({
        bootSessionId: UUID,
        catalogIds: [],
        viewingSessionId: null,
        localDraft: false,
      }),
      "wait-pinned",
    );
    assert.equal(
      decideBootOpen({
        bootSessionId: UUID,
        catalogIds: ["other", UUID],
        viewingSessionId: null,
        localDraft: false,
      }),
      "select-pinned",
    );
    assert.equal(
      decideBootOpen({
        bootSessionId: null,
        catalogIds: ["other"],
        viewingSessionId: null,
        localDraft: false,
      }),
      "open-newest",
    );
    assert.equal(
      decideBootOpen({
        bootSessionId: UUID,
        catalogIds: [UUID],
        viewingSessionId: "already",
        localDraft: false,
      }),
      "already-open",
    );
    assert.equal(
      decideBootOpen({
        bootSessionId: null,
        catalogIds: [],
        viewingSessionId: null,
        localDraft: true,
      }),
      "already-open",
    );
  });

  it("formats titles and shortcut hints", () => {
    assert.equal(formatSessionWindowTitle("Ship the rail", true), "Ship the rail");
    assert.equal(formatSessionWindowTitle("", false), "Grok Desktop");
    assert.equal(formatSessionWindowTitle("", true), "Untitled chat");
    assert.equal(sessionWindowShortcutLabel("MacIntel"), "⌘⇧N");
    assert.equal(sessionWindowShortcutLabel("Win32"), "Ctrl+Shift+N");
  });

  it("resolves the row id ahead of the canvas", () => {
    const target = resolveSessionWindowTarget({
      requestedId: "row-1",
      requestedTitle: "From the row",
      viewingSessionId: "viewed",
      canvasSessionId: "canvas",
      canvasTitle: "Canvas",
      titleForId: () => "Catalog",
    });
    assert.deepEqual(target, { sessionId: "row-1", title: "From the row" });
    const viewed = resolveSessionWindowTarget({
      viewingSessionId: "viewed",
      canvasSessionId: "canvas",
      canvasTitle: "Canvas",
      titleForId: (id) => (id === "viewed" ? "Viewed title" : undefined),
    });
    assert.equal(viewed?.sessionId, "viewed");
    assert.equal(viewed?.title, "Viewed title");
    const draft = resolveSessionWindowTarget({
      viewingSessionId: null,
      canvasSessionId: "",
      canvasTitle: "",
      titleForId: () => undefined,
    });
    assert.equal(draft, null);
  });

  it("posts open to the shell and falls back to window.open", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const shell = await openSessionInNewWindow("sess-1", "Alpha", {
      shellHost: true,
      origin: "wails://wails",
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ ok: true, created: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });
    assert.deepEqual(shell, { ok: true, via: "shell", created: true });
    assert.equal(calls[0]?.url, "wails://wails/__grok_desktop_window");
    assert.equal(
      calls[0]?.body,
      JSON.stringify({ op: "open", sessionId: "sess-1", title: "Alpha" }),
    );

    const opened: string[] = [];
    const browser = await openSessionInNewWindow("sess-1", "Alpha", {
      shellHost: false,
      origin: "http://localhost:5173",
      openImpl: (url) => {
        opened.push(url);
      },
    });
    assert.deepEqual(browser, { ok: true, via: "browser" });
    assert.deepEqual(opened, ["http://localhost:5173/?session=sess-1"]);

    const rejected = await openSessionInNewWindow("../x", "Nope", {
      shellHost: false,
      openImpl: () => {
        throw new Error("should not open");
      },
    });
    assert.deepEqual(rejected, { ok: false, reason: "invalid" });
  });

  it("pushes a native title only inside the shell", async () => {
    const titles: string[] = [];
    const ok = await pushNativeWindowTitle("Beta", {
      shellHost: true,
      origin: "https://wails.localhost",
      fetchImpl: (async (_url, init) => {
        titles.push(String(init?.body ?? ""));
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(ok, true);
    assert.equal(titles[0], JSON.stringify({ op: "set_title", title: "Beta" }));
    const skipped = await pushNativeWindowTitle("Beta", { shellHost: false });
    assert.equal(skipped, false);
  });
});
