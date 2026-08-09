/**
 * Agent mode catalog and pure cycle helpers for Composer mode control.
 * Side-effect descriptions come from the product design mode model (ask / plan / build).
 * Unknown mode ids fall back to build so chrome never renders an empty label.
 */

import type { AgentMode } from "@grok-desktop/acp-core";

/** One selectable mode row: id, short label, and one-line side-effect promise. */
export type AgentModeOption = {
  /** Protocol / product mode id. */
  id: AgentMode;
  /** Short UI label (Ask / Plan / Build). */
  label: string;
  /** One-line description of what this mode allows or forbids. */
  description: string;
};

/** Fixed cycle order: build → plan → ask → build (⇧Tab / cycle control). */
export const MODE_CYCLE_ORDER: readonly AgentMode[] = [
  "build",
  "plan",
  "ask",
] as const;

/**
 * Catalog of modes shown in the Composer mode popover.
 * Order matches MODE_CYCLE_ORDER so list and keyboard stay aligned.
 */
export const AGENT_MODE_OPTIONS: readonly AgentModeOption[] = [
  {
    id: "build",
    label: "Build",
    description: "Write + shell (sandboxed)",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Read-only explore + produce a plan",
  },
  {
    id: "ask",
    label: "Ask",
    description: "Q&A only — no side effects",
  },
] as const;

/**
 * Normalize an arbitrary mode string to a known AgentMode.
 * @param mode Raw mode from session or UI; unknown/empty → "build".
 * @returns Known agent mode id.
 */
export function normalizeAgentMode(mode: string | undefined | null): AgentMode {
  if (mode === "ask" || mode === "plan" || mode === "build") {
    return mode;
  }
  return "build";
}

/**
 * Map mode id to display label.
 * @param mode Agent or raw mode string; unknown values fall back to Build.
 * @returns Fixed English label.
 */
export function modeLabel(mode: string | undefined | null): string {
  const id = normalizeAgentMode(mode);
  return AGENT_MODE_OPTIONS.find((o) => o.id === id)?.label ?? "Build";
}

/**
 * Advance mode in the product cycle (build → plan → ask → build).
 * @param current Current mode; unknown values treated as build before advancing.
 * @returns Next mode in the cycle.
 */
export function nextMode(current: string | undefined | null): AgentMode {
  const id = normalizeAgentMode(current);
  const idx = MODE_CYCLE_ORDER.indexOf(id);
  const next = MODE_CYCLE_ORDER[(idx + 1) % MODE_CYCLE_ORDER.length];
  return next ?? "build";
}

/**
 * Whether pending mode has been confirmed by the agent (or local fallback).
 * @param pendingMode Mode the user requested; null means nothing pending.
 * @param confirmedMode Mode currently on the session from agent/store.
 * @returns True when pending should clear (match or no pending).
 */
export function isPendingModeResolved(
  pendingMode: AgentMode | null,
  confirmedMode: string | undefined | null,
): boolean {
  if (pendingMode === null) {
    return true;
  }
  return normalizeAgentMode(confirmedMode) === pendingMode;
}

/** Default timeout before optimistic settle if agent never confirms (ms). */
export const MODE_PENDING_TIMEOUT_MS = 3000;
