/**
 * Local image attachments + drag/drop/paste handlers for Composer.
 * Keeps high-frequency attachment state out of the global session store.
 */

import {
  useCallback,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from "react";
import type { ContentBlock } from "@grok-desktop/acp-core";
import {
  agentSupportsImageInput,
  buildPromptBlocks,
  fileToImageAttachment,
  imageUnsupportedMessage,
  type ImageAttachment,
} from "../../lib/mediaInput";
import {
  insertFileMentions,
  processDataTransfer,
} from "../../lib/composerDrop";

export type UseComposerAttachmentsArgs = {
  /** Agent capability snapshot; drives image accept vs degrade. */
  agentCapabilities: unknown;
  /** Current draft text for @mention insert on drop. */
  draft: string;
  /** Update draft after file-mention insert. */
  setDraft: (text: string | ((prev: string) => string)) => void;
  /** Textarea ref for caret position on drop. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Surface a user-visible hint (capability / skip). */
  setSendHint: (hint: string) => void;
};

/**
 * Attachment list + paste/drag/drop handlers bound to agent image capability.
 * @param args Draft, capability, and hint setters from the parent composer hook.
 * @returns Attachment state and event handlers for ComposerInputView.
 */
export function useComposerAttachments(args: UseComposerAttachmentsArgs) {
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const imageCapable = agentSupportsImageInput(args.agentCapabilities);

  /**
   * Accept an image attachment when capability allows; otherwise explicit degrade.
   * @param att Parsed image attachment.
   */
  const acceptImageAttachment = useCallback(
    (att: ImageAttachment) => {
      if (!imageCapable) {
        args.setSendHint(imageUnsupportedMessage());
        return;
      }
      setAttachments((prev) => [...prev, att]);
      args.setSendHint(
        `Attached image (${att.mimeType}) — will send with next message`,
      );
    },
    [args, imageCapable],
  );

  /**
   * Build ContentBlocks for the current draft + attachments.
   * When agent lacks image_input, images are stripped and a hint is set.
   */
  const buildOutgoingBlocks = useCallback((): {
    blocks: ContentBlock[] | undefined;
    text: string;
  } => {
    const text = args.draft;
    if (attachments.length === 0) {
      return { blocks: undefined, text };
    }
    if (!imageCapable) {
      args.setSendHint(imageUnsupportedMessage());
      return { blocks: undefined, text };
    }
    return {
      blocks: buildPromptBlocks(text, attachments) as ContentBlock[],
      text,
    };
  }, [args, attachments, imageCapable]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      let sawImage = false;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          sawImage = true;
          const file = item.getAsFile();
          if (file) {
            void fileToImageAttachment(file).then((att) => {
              if (att) {
                acceptImageAttachment(att);
              }
            });
          }
        }
      }
      if (sawImage) {
        event.preventDefault();
      }
    },
    [acceptImageAttachment],
  );

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      void processDataTransfer(event.dataTransfer).then((result) => {
        if (result.fileMentions.length > 0) {
          const caret = args.textareaRef.current?.selectionStart;
          const next = insertFileMentions(
            args.draft,
            result.fileMentions,
            caret,
          );
          args.setDraft(next.text);
        }
        for (const img of result.images) {
          acceptImageAttachment(img);
        }
        if (result.skipped.length > 0) {
          args.setSendHint(`Skipped: ${result.skipped.join(", ")}`);
        }
      });
    },
    [acceptImageAttachment, args],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  return {
    attachments,
    dragOver,
    imageCapable,
    acceptImageAttachment,
    buildOutgoingBlocks,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    clearAttachments,
  };
}
