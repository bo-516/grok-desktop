/**
 * Pure send-path orchestration for the Composer.
 * Extracted from useComposerWidget so that hook stays under the line limit.
 * Disk reads and block assembly stay in useComposerAttachments / mentionAttachments.
 */

import type { ContentBlock } from "@grok-desktop/acp-core";
import { materializeMentionTriggers } from "@/lib/mentionTokens";
import type { ComposerNoticeTone } from "./composerStatus";

export type ComposerSubmitContext = {
  /** Frozen draft snapshot at click time. */
  sentDraft: string;
  attachmentCount: number;
  connectionMode: string;
  streaming: boolean;
  waitingPermission: boolean;
  canSend: boolean;
  bridgeInfo: string;
  /**
   * Resolve outgoing blocks (mentions + images). Async because bridge read.
   * Captures draft/attachments from the submit render; safe to clear the
   * input before the promise settles.
   */
  buildOutgoingBlocks: () => Promise<{
    blocks: ContentBlock[] | undefined;
    text: string;
    hint: string;
  }>;
  sendPrompt: (text: string, blocks?: ContentBlock[]) => Promise<boolean>;
  showNotice: (text: string, tone: ComposerNoticeTone) => void;
  clearNotice: () => void;
  clearDraftIfUnchanged: (sentDraft: string) => void;
  /** Put text back into the composer after a hard send failure. */
  restoreDraft: (sentDraft: string) => void;
  clearAttachments: () => void;
  stopDictation: () => void;
};

/**
 * Run one submit attempt for the current draft snapshot.
 * Queued path is plain text only (queue stores strings) with an explicit notice.
 * Idle path clears the input immediately so create-session latency does not
 * leave the draft sitting in the dock while the timeline already shows the bubble.
 * @param ctx Freeze-frame of composer + bridge capabilities at click time.
 * @returns void; all outcomes surface via showNotice / sendPrompt side effects.
 */
export function runComposerSubmit(ctx: ComposerSubmitContext): void {
  ctx.stopDictation();
  if (!ctx.sentDraft.trim() && ctx.attachmentCount === 0) {
    return;
  }
  if (ctx.connectionMode === "disconnected") {
    ctx.showNotice(
      "Bridge not connected — run npm run bridge and reconnect",
      "warn",
    );
    return;
  }
  if (ctx.streaming || ctx.waitingPermission) {
    if (ctx.attachmentCount > 0) {
      ctx.showNotice(
        "Attachments wait until the current turn finishes — send again when idle",
        "warn",
      );
      return;
    }
    ctx.showNotice(
      "Queued as plain text (file embeds attach when sent while idle)",
      "info",
    );
    void ctx
      .sendPrompt(materializeMentionTriggers(ctx.sentDraft))
      .then((sent) => {
        if (sent) {
          ctx.clearDraftIfUnchanged(ctx.sentDraft);
        }
      });
    return;
  }
  if (!ctx.canSend) {
    return;
  }

  ctx.clearNotice();
  // Clear the dock immediately; buildOutgoingBlocks still uses the click-time
  // closure values. On hard failure we restore the text (attachments are not
  // re-hydrated — rare path after create/connect failure).
  ctx.clearDraftIfUnchanged(ctx.sentDraft);
  ctx.clearAttachments();
  void ctx.buildOutgoingBlocks().then(({ blocks, text, hint }) => {
    if (hint) {
      ctx.showNotice(hint, "warn");
    }
    return ctx.sendPrompt(text, blocks).then((sent) => {
      if (sent) {
        if (!hint) {
          ctx.clearNotice();
        }
      } else {
        ctx.restoreDraft(ctx.sentDraft);
        ctx.showNotice(
          ctx.bridgeInfo.startsWith("error:") ||
            /unable|cannot|failed/i.test(ctx.bridgeInfo)
            ? ctx.bridgeInfo
            : "Send failed — draft restored; check the connection or start a new chat",
          "warn",
        );
      }
    });
  });
}
