/**
 * Environment sheet store: inspect+mcp load, doctor merge, write refresh,
 * and loaded-ago labels.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  ENVIRONMENT_STALE_MS,
  formatLoadedAgo,
  selectMcpRows,
  selectSkillRows,
  useEnvironmentStore,
  type EnvironmentCliRunner,
} from "@/store/environmentStore";

/** Directory of sanitized inspect / mcp fixtures used by the store load path. */
const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

/**
 * Load a JSON fixture relative to test/fixtures.
 * @param name File name under fixtures/.
 */
function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as unknown;
}

/**
 * Reset the singleton Zustand store between cases.
 */
function resetEnvironmentStore(): void {
  useEnvironmentStore.setState({
    page: "overview",
    snapshot: null,
    status: "idle",
    error: null,
    loadedAt: null,
    doctor: {},
    pending: {},
  });
}

/**
 * CLI runner that answers inspect / mcp_list / mcp_doctor from fixtures.
 * @param opts Per-command overrides (ok/error/delay).
 */
function fixtureCli(opts?: {
  inspectOk?: boolean;
  mcpListOk?: boolean;
  delayMs?: number;
}): EnvironmentCliRunner {
  const inspectOk = opts?.inspectOk !== false;
  const mcpListOk = opts?.mcpListOk !== false;
  const delayMs = opts?.delayMs ?? 0;
  return async (command, args) => {
    if (delayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
    if (command === "inspect") {
      return inspectOk
        ? { ok: true, data: loadFixture("inspect.json") }
        : { ok: false, error: "inspect failed" };
    }
    if (command === "mcp_list") {
      return mcpListOk
        ? { ok: true, data: loadFixture("mcp-list-empty.json") }
        : { ok: false, error: "mcp list failed" };
    }
    if (command === "mcp_doctor") {
      return { ok: true, data: loadFixture("mcp-doctor-browser-use.json") };
    }
    return { ok: true, data: { command, args } };
  };
}

beforeEach(() => {
  resetEnvironmentStore();
});

afterEach(() => {
  resetEnvironmentStore();
});

describe("formatLoadedAgo", () => {
  it("returns null when never loaded", () => {
    assert.equal(formatLoadedAgo(null, 1_000_000), null);
  });

  it("formats just now / seconds / minutes / hours", () => {
    const now = 1_000_000;
    assert.equal(formatLoadedAgo(now - 3_000, now), "just now");
    assert.equal(formatLoadedAgo(now - 30_000, now), "30s ago");
    assert.equal(formatLoadedAgo(now - 120_000, now), "2m ago");
    assert.equal(formatLoadedAgo(now - 7_200_000, now), "2h ago");
  });
});

describe("ENVIRONMENT_STALE_MS", () => {
  it("is 60 seconds", () => {
    assert.equal(ENVIRONMENT_STALE_MS, 60_000);
  });
});

describe("useEnvironmentStore.load", () => {
  it("merges inspect + mcp list into a ready snapshot", async () => {
    await useEnvironmentStore.getState().load(fixtureCli());
    const state = useEnvironmentStore.getState();
    assert.equal(state.status, "ready");
    assert.equal(state.error, null);
    assert.ok(state.loadedAt);
    assert.ok((state.snapshot?.skills.length ?? 0) > 0);
    const rows = selectMcpRows(state.snapshot);
    assert.ok(rows.some((row) => row.name === "browser-use"));
  });

  it("skips a second load while the snapshot is fresh", async () => {
    let inspectCalls = 0;
    const runCli: EnvironmentCliRunner = async (command) => {
      if (command === "inspect") {
        inspectCalls += 1;
      }
      return fixtureCli()(command);
    };
    await useEnvironmentStore.getState().load(runCli);
    await useEnvironmentStore.getState().load(runCli);
    assert.equal(inspectCalls, 1);
  });

  it("still succeeds when mcp_list fails (inspect-only merge)", async () => {
    await useEnvironmentStore.getState().load(fixtureCli({ mcpListOk: false }));
    const state = useEnvironmentStore.getState();
    assert.equal(state.status, "ready");
    assert.ok(state.snapshot?.mcpServers.some((row) => row.name === "browser-use"));
  });

  it("surfaces inspect failure without a snapshot", async () => {
    await useEnvironmentStore.getState().load(fixtureCli({ inspectOk: false }));
    const state = useEnvironmentStore.getState();
    assert.equal(state.status, "error");
    assert.match(state.error ?? "", /inspect failed/);
    assert.equal(state.snapshot, null);
  });

  it("ignores a concurrent load while one is in flight", async () => {
    let inspectCalls = 0;
    const runCli: EnvironmentCliRunner = async (command) => {
      if (command === "inspect") {
        inspectCalls += 1;
      }
      return fixtureCli({ delayMs: 40 })(command);
    };
    const first = useEnvironmentStore.getState().load(runCli);
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    assert.equal(useEnvironmentStore.getState().status, "loading");
    const second = useEnvironmentStore.getState().load(runCli);
    await Promise.all([first, second]);
    assert.equal(inspectCalls, 1);
  });
});

describe("useEnvironmentStore.runDoctor / runAction", () => {
  it("merges doctor health onto the snapshot row", async () => {
    await useEnvironmentStore.getState().load(fixtureCli());
    await useEnvironmentStore.getState().runDoctor(fixtureCli(), "browser-use");
    const row = useEnvironmentStore
      .getState()
      .snapshot?.mcpServers.find((item) => item.name === "browser-use");
    assert.equal(row?.health?.healthy, true);
    assert.ok((row?.health?.checks.length ?? 0) > 0);
    assert.equal(
      useEnvironmentStore.getState().pending["mcp:browser-use:doctor"],
      undefined,
    );
  });

  it("runAction refreshes on success and records errors", async () => {
    await useEnvironmentStore.getState().load(fixtureCli());
    let loadCalls = 0;
    const okCli: EnvironmentCliRunner = async (command, args) => {
      if (command === "inspect" || command === "mcp_list") {
        loadCalls += 1;
      }
      return fixtureCli()(command, args);
    };
    const ok = await useEnvironmentStore
      .getState()
      .runAction(okCli, "mcp:x:enable", "mcp_enable", { name: "x" });
    assert.equal(ok, true);
    assert.ok(loadCalls >= 2);

    resetEnvironmentStore();
    const failCli: EnvironmentCliRunner = async () => ({
      ok: false,
      error: "denied",
    });
    const failed = await useEnvironmentStore
      .getState()
      .runAction(failCli, "mcp:x:remove", "mcp_remove");
    assert.equal(failed, false);
    assert.equal(useEnvironmentStore.getState().error, "denied");
  });
});

describe("selectMcpRows", () => {
  it("returns an empty array before the first load", () => {
    assert.deepEqual(selectMcpRows(null), []);
  });
});

describe("selectSkillRows", () => {
  it("returns an empty array before the first load", () => {
    assert.deepEqual(selectSkillRows(null), []);
  });
});
