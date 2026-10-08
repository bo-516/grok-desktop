/**
 * Stateless "update available" banner.
 * No store, no fetch, no effects. The widget opens links and dismisses.
 */

export type UpdateNoticeViewProps = {
  /** Canonical semver newer than this build. */
  version: string;
  /** Open the GitHub release notes in the system browser. */
  onOpenNotes: () => void;
  /** Open the platform zip (or the release page) in the system browser. */
  onOpenDownload: () => void;
  /** Hide this version until a newer tag is published. */
  onDismiss: () => void;
};

/**
 * Non-blocking notice. Sits with the other shell banners; it does not take
 * focus and it does not install anything.
 * @param props Version text and the three actions.
 * @returns The banner row.
 */
export function UpdateNoticeView(props: UpdateNoticeViewProps) {
  return (
    <div
      className="banner flex flex-wrap items-center gap-2"
      role="status"
      data-update-notice=""
    >
      <span>Update available: {props.version}</span>
      <button type="button" className="btn-ghost" onClick={props.onOpenNotes}>
        Release notes
      </button>
      <button
        type="button"
        className="btn-ghost"
        onClick={props.onOpenDownload}
      >
        Download
      </button>
      <button type="button" className="btn-ghost" onClick={props.onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
