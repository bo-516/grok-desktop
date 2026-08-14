/**
 * Shared Plan|Agents drawer width tokens. Used by the panel store and the
 * shell width helper so neither has to import the other.
 *
 * Default is a side rail (~300px), not half the chat column. Bump the
 * storage key when changing these so a persisted old width cannot
 * override the new default.
 */

/** Default Plan|Agents drawer width in px (shared by both tabs). */
export const AGENTS_WIDTH_DEFAULT = 300;

/** Minimum drag width for the shared Plan|Agents drawer. */
export const AGENTS_WIDTH_MIN = 200;

/** Maximum drag width for the shared Plan|Agents drawer. */
export const AGENTS_WIDTH_MAX = 432;

/** localStorage key for last Plan|Agents drawer width (global). */
export const AGENTS_WIDTH_STORAGE_KEY = "grok-desktop.agents-width.v3";
