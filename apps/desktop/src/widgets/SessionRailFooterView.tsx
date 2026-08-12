/**
 * Session rail footer shell: density cue + workspace menu chip
 * (Settings / Overview / Environment / Reconnect). Stateless —
 * open state and quota suppress live in {@link SessionRailWorkspaceMenuWidget}.
 */

import { SessionRailWorkspaceMenuWidget } from "./SessionRailWorkspaceMenuWidget";

export type SessionRailFooterViewProps = {
  /** Catalog size for the density bar and "Sessions" label. */
  catalogLength: number;
  /** Sessions currently streaming (badge on Tasks / trigger). */
  streamingCount: number;
  /** True when connectionMode is live-bridge. */
  live: boolean;
  /** Footer "N running" count (streaming sessions). */
  liveCount: number;
  /** Reconnect / restore the live bridge. */
  onReconnect: () => void;
};

/**
 * Soft footer under the project scroll list.
 * @param props Counts, live flags, and reconnect handler.
 * @returns Footer block for the left side-nav.
 */
export function SessionRailFooterView(props: SessionRailFooterViewProps) {
  const {
    catalogLength,
    streamingCount,
    live,
    liveCount,
    onReconnect,
  } = props;

  return (
    <div className="side-nav-footer">
      <SessionRailWorkspaceMenuWidget
        catalogLength={catalogLength}
        streamingCount={streamingCount}
        live={live}
        liveCount={liveCount}
        onReconnect={onReconnect}
      />
    </div>
  );
}
