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
   * Captures draft/attachments from the submit render; must still see the
   * staged images until this promise is invoked (do not clear the dock first).
   */
  buildOutgoingBlocks: () => Promise<{
    blocks: ContentBlock[] | undefined;
    text: string;
    hint: string;
  }>;
  sendPrompt: (text: string, blocks?: ContentBlock[]) => Promise<boolean>;
  /**
   * Intercept desktop pager commands (`/model`, `/effort`) before send.
   * Return true to stop the submit path (applied or shown as an error).
   * Omitted treats every draft as agent-bound.
   */
  tryLocalSlash?: (draft: string) => boolean;
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
 *
 * Idle path order is intentional (avoids a blank flash):
 * 1. Keep draft + attachment strip while `@` files assemble (async).
 * 2. Call sendPrompt — paints the optimistic timeline bubble **synchronously**
 *    before its first await (images already on the canvas).
 * 3. Only then clear the dock so the strip does not vanish into a gap frame.
 *
 * @param ctx Freeze-frame of composer + bridge capabilities at click time.
 * @returns void; all outcomes surface via showNotice / sendPrompt side effects.
 */
export function runComposerSubmit(ctx: ComposerSubmitContext): void {
  ctx.stopDictation();
  if (ctx.tryLocalSlash?.(ctx.sentDraft)) {
    return;
  }
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
  // Do not clear draft/attachments before build+paint — that left a visible
  // empty frame (composer strip gone, timeline bubble not yet painted) and
  // made attached images look like they disappeared on send.
  void ctx.buildOutgoingBlocks().then(({ blocks, text, hint }) => {
    if (hint) {
      ctx.showNotice(hint, "warn");
    }
    // sendPrompt paints the user row on its first synchronous lines (before
    // any await). Invoke, then clear the dock so thumbs hand off without a gap.
    const sendPromise = ctx.sendPrompt(text, blocks);
    ctx.clearDraftIfUnchanged(ctx.sentDraft);
    ctx.clearAttachments();
    return sendPromise.then((sent) => {
      if (sent) {
        if (!hint) {
          ctx.clearNotice();
        }
      } else {
        ctx.restoreDraft(ctx.sentDraft);
        // Attachments are not re-hydrated on this rare failure path (payload
        // was already assembled; user can re-attach if create/connect failed).
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
