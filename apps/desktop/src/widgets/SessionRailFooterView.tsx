/**
 * Session rail footer: local session density cue + workspace menu chip
 * (Settings / Tasks / Overview / Extensions / Reconnect). Stateless shell —
 * menu open state lives in {@link SessionRailWorkspaceMenuWidget}.
 */

import type { CSSProperties } from "react";
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
      <div className="side-nav-quota" title="Local session count">
        <span className="side-nav-quota-label">Sessions</span>
        <span className="side-nav-quota-value">{catalogLength}</span>
        <div className="side-nav-quota-track" aria-hidden="true">
          <div
            className="side-nav-quota-fill"
            style={
              {
                /* width only — catalog density cue, not a color token */
                width: `${Math.min(100, Math.max(8, catalogLength * 8))}%`,
              } satisfies CSSProperties
            }
          />
        </div>
      </div>

      <SessionRailWorkspaceMenuWidget
        streamingCount={streamingCount}
        live={live}
        liveCount={liveCount}
        onReconnect={onReconnect}
      />
    </div>
  );
}
