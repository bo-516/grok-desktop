/// <reference types="vite/client" />

declare module "virtual:uno.css";

/**
 * Product semver injected by Vite from the repo-root package.json
 * (or the VERSION env var). Absent under tsx unit tests; readers must use
 * typeof so a missing define does not throw.
 */
declare const __APP_VERSION__: string | undefined;
