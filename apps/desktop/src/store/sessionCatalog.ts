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
  cleanHarnessGoalTitle,
  displaySessionTitle,
  extractTitleFromTimeline,
  fallbackSessionLabel,
  isHarnessGoalTitle,
  isWeakSessionTitle,
  pickSessionTitle,
  shortSessionId,
  titleFromSessionState,
} from "./sessionCatalogTypes";
export {
  catalogRefsEqual,
  resolveCatalogUpdatedAt,
  upsertFromLiveState,
} from "./sessionCatalogUpsert";
export {
  CATALOG_SCHEMA_VERSION,
  migrateCatalogToCurrent,
  migrateCatalogV1toV2,
} from "./sessionCatalogMigration";
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
  normalizeCatalogRow,
  pruneEmptyWeakSessions,
  recordToSessionState,
  rehydrateCatalogTitles,
  saveCatalogToStorage,
} from "./sessionCatalogStorage";
