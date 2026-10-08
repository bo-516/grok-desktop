/**
 * Stateful update banner. Thin: the hook owns the check, the view paints it.
 * Links go through openExternalUrl so Wails opens the system browser instead
 * of navigating the webview.
 */

import { openExternalUrl } from "@/lib/openExternalUrl";
import { UpdateNoticeView } from "@/widgets/updateNotice/UpdateNoticeView";
import { useUpdateNoticeWidget } from "@/widgets/updateNotice/useUpdateNoticeWidget";

/**
 * Mount once in the main column. Renders nothing when there is no newer
 * release, checks are disabled, or the user dismissed this version.
 * @returns The banner, or null.
 */
export function UpdateNoticeWidget() {
  const model = useUpdateNoticeWidget();
  const notice = model.notice;
  if (!notice) {
    return null;
  }
  return (
    <UpdateNoticeView
      version={notice.version}
      onOpenNotes={() => {
        void openExternalUrl(notice.notesUrl);
      }}
      onOpenDownload={() => {
        void openExternalUrl(notice.downloadUrl);
      }}
      onDismiss={model.dismiss}
    />
  );
}
