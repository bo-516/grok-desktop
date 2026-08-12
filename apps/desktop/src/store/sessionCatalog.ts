/**
 * Session catalog: persist + group by project (Codex-style mission control).
 * Pure helpers — no React. Storage is localStorage in the browser.
 *
 * Implementation is split by domain; this file re-exports the public API.
 */

export type {
  ProjectGroup,
  SessionRecord,
  TimeBucket,
  TimeGroup,
} from "./sessionCatalogTypes";
export {
  NO_PROJECT_KEY,
  SESSION_STORAGE_KEY,
  extractTitleFromTimeline,
  fallbackSessionLabel,
  isWeakSessionTitle,
  pickSessionTitle,
  titleFromSessionState,
} from "./sessionCatalogTypes";
export {
  resolveCatalogUpdatedAt,
  upsertFromLiveState,
} from "./sessionCatalogUpsert";
export {
  compareByFirstCharAscii,
  formatRelativeTime,
  groupSessionsByProject,
  groupSessionsByTime,
  isNoProjectSession,
  projectNameFromWorkspace,
  splitNoProjectSessions,
  timeBucketFor,
} from "./sessionCatalogGroup";
export {
  loadCatalogFromStorage,
  normalizeCatalog,
  pruneEmptyWeakSessions,
  recordToSessionState,
  rehydrateCatalogTitles,
  saveCatalogToStorage,
} from "./sessionCatalogStorage";
