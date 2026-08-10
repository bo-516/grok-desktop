/**
 * Preview drawer target state — independent of sessionStore so timeline
 * subscribers do not re-render when the user opens a file/diff preview.
 * Width drag lives in the drawer widget; setWidth persists on pointer-up.
 */

import { create } from "zustand";

/**
 * What the right preview rail should show.
 * - file: bridge read of workspace disk content
 * - diff: one tool-call diff fragment (session data, no git)
 * - changeset: turn or session aggregate list
 */
export type PreviewTarget =
  | { kind: "file"; path: string; cwd?: string; line?: number }
  | { kind: "diff"; path: string; toolCallId: string }
  /**
   * Turn-scoped change list. Prefer `toolCallIds` captured at open time so the
   * drawer does not re-derive turn membership (timeline regroup can change ids).
   */
  | {
      kind: "changeset";
      scope: "turn";
      turnId: string;
      /** Tool-call ids in activity order from the opening turn unit. */
      toolCallIds?: string[];
    }
  | { kind: "changeset"; scope: "session" };

/** Default preview rail width in px (design: wider than plan 280). */
export const PREVIEW_WIDTH_DEFAULT = 560;

/** Minimum drag width for the preview rail. */
export const PREVIEW_WIDTH_MIN = 420;

/** Maximum drag width for the preview rail. */
export const PREVIEW_WIDTH_MAX = 900;

/** localStorage key for last preview width (global). */
export const PREVIEW_WIDTH_STORAGE_KEY = "grok-desktop.preview-width.v1";

/**
 * Clamp a pixel width into the design preview range.
 * @param px Raw width from drag or storage.
 * @returns Integer px within [min, max].
 */
export function clampPreviewWidth(px: number): number {
  if (!Number.isFinite(px)) {
    return PREVIEW_WIDTH_DEFAULT;
  }
  return Math.min(
    PREVIEW_WIDTH_MAX,
    Math.max(PREVIEW_WIDTH_MIN, Math.round(px)),
  );
}

/**
 * Load persisted preview width from localStorage (browser); default otherwise.
 * @returns Clamped width in px.
 */
export function loadPreviewWidth(): number {
  if (typeof localStorage === "undefined") {
    return PREVIEW_WIDTH_DEFAULT;
  }
  try {
    const raw = localStorage.getItem(PREVIEW_WIDTH_STORAGE_KEY);
    if (raw == null) {
      return PREVIEW_WIDTH_DEFAULT;
    }
    return clampPreviewWidth(Number(raw));
  } catch {
    return PREVIEW_WIDTH_DEFAULT;
  }
}

/**
 * Persist preview width to localStorage.
 * @param px Width to store (clamped first).
 */
export function savePreviewWidth(px: number): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      PREVIEW_WIDTH_STORAGE_KEY,
      String(clampPreviewWidth(px)),
    );
  } catch {
    // quota / private mode — ignore
  }
}

type PreviewStoreState = {
  /** Active preview target, or null when nothing is open. */
  target: PreviewTarget | null;
  /** Last committed rail width (not live drag). */
  width: number;
  /** Unified is the only shipped mode in S0–S1; split reserved for S2. */
  viewMode: "unified" | "split";
  /**
   * Open (or replace) the preview target. Shell opens the preview rail.
   * @param t Next target; replaces any previous target.
   */
  openPreview: (t: PreviewTarget) => void;
  /** Clear the target; shell should close the preview rail. */
  closePreview: () => void;
  /**
   * Commit a new width (pointer-up). Clamps and persists.
   * @param px Desired width in CSS pixels.
   */
  setWidth: (px: number) => void;
  /**
   * Switch unified/split (S2 split is a no-op renderer today).
   * @param mode View mode.
   */
  setViewMode: (mode: "unified" | "split") => void;
};

/**
 * Zustand store for the code/diff preview drawer.
 * Subscribe by field so timeline open actions only touch consumers that need it.
 */
export const usePreviewStore = create<PreviewStoreState>((set) => ({
  target: null,
  width: loadPreviewWidth(),
  viewMode: "unified",
  openPreview: (t) => set({ target: t }),
  closePreview: () => set({ target: null }),
  setWidth: (px) => {
    const width = clampPreviewWidth(px);
    savePreviewWidth(width);
    set({ width });
  },
  setViewMode: (mode) => set({ viewMode: mode }),
}));
