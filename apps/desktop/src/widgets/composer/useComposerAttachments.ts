/**
 * Local image attachments + drag/drop/paste + file-picker handlers for Composer.
 * Also assembles committed @mention embedded resource blocks via bridge read.
 * Keeps high-frequency attachment state out of the global session store.
 */

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from "react";
import type { ContentBlock } from "@grok-desktop/acp-core";
import {
  assembleMentionBlocks,
  formatMentionAttachmentHint,
  prepareMentionSend,
  type MentionFileReadResult,
} from "@/lib/mentionAttachments";
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
import type { ComposerNoticeTone } from "./composerStatus";

export type UseComposerAttachmentsArgs = {
  /** Agent capability snapshot; drives image accept vs degrade. */
  agentCapabilities: unknown;
  /** Current draft text for @mention insert on drop. */
  draft: string;
  /** Update draft after file-mention insert. */
  setDraft: (text: string | ((prev: string) => string)) => void;
  /** Textarea ref for caret position on drop. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /**
   * Surface a user-visible notice (capability / skip / degrade).
   * @param text Notice sentence.
   * @param tone info auto-clears; warn sticks until clear/send.
   */
  showNotice: (text: string, tone: ComposerNoticeTone) => void;
  /**
   * Bridge read for mention embedding. When missing, mentions send as text only
   * with an explicit notice (never silent).
   */
  readWorkspaceFile?: (
    path: string,
    cwd?: string,
  ) => Promise<MentionFileReadResult>;
  /** Session workspace root for file:// URIs and read cwd. */
  workspace?: string;
};

/**
 * Attachment list + paste/drag/drop/file-picker handlers bound to agent image capability.
 * @param args Draft, capability, bridge read, and notice writers from the parent composer hook.
 * @returns Attachment state and event handlers for ComposerInputView / attach button.
 */
export function useComposerAttachments(args: UseComposerAttachmentsArgs) {
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  /** Hidden `<input type="file">` driven by the composer + attach chip. */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageCapable = agentSupportsImageInput(args.agentCapabilities);

  /**
   * Stage an image for the composer strip (always show preview).
   * When the agent lacks image input, keep the thumb + warn; send path still
   * omits image ContentBlocks so we never pretend the wire accepted them.
   * @param att Parsed image attachment (mime + base64).
   */
  const acceptImageAttachment = useCallback(
    (att: ImageAttachment) => {
      setAttachments((prev) => [...prev, att]);
      if (!imageCapable) {
        // Preview is local UI only — capability gate remains on buildOutgoingBlocks.
        args.showNotice(imageUnsupportedMessage(), "warn");
        return;
      }
      args.showNotice(
        `Attached image (${att.mimeType}) — will send with next message`,
        "info",
      );
    },
    [args, imageCapable],
  );

  /**
   * Open the native multi-image file picker (Codex-style + control).
   * Prefer showPicker() so the browser does not focus a clipped input (that
   * scroll-into-view path was jittering the composer dock height). Falls back
   * to input.click() when showPicker is missing or rejects.
   * No-op when the hidden input is unmounted.
   */
  const openFilePicker = useCallback(() => {
    const input = fileInputRef.current;
    if (!input) {
      return;
    }
    // Clear so re-picking the same path still fires change.
    input.value = "";
    // showPicker avoids focusing the layout-inert input; keeps dock height stable.
    if (typeof input.showPicker === "function") {
      try {
        void input.showPicker();
        return;
      } catch {
        // Not allowed outside a user gesture or unsupported — use click().
      }
    }
    input.click();
  }, []);

  /**
   * Handle files chosen via the attach picker.
   * Images become ContentBlock attachments; non-images are skipped with a notice
   * (workspace paths still use @mention / drag-drop, not the file picker).
   * @param event Change event from the hidden file input.
   */
  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // Always reset so the next open is not stuck on the previous selection.
      event.target.value = "";
      if (files.length === 0) {
        return;
      }
      const skipped: string[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          skipped.push(file.name || "file");
          continue;
        }
        void fileToImageAttachment(file).then((att) => {
          if (att) {
            acceptImageAttachment(att);
          } else {
            args.showNotice(`Could not read image: ${file.name}`, "warn");
          }
        });
      }
      if (skipped.length > 0) {
        args.showNotice(
          `Only images can be attached here (skipped: ${skipped.join(", ")}). Use @ to mention workspace files.`,
          "warn",
        );
      }
    },
    [acceptImageAttachment, args],
  );

  /**
   * Build ContentBlocks for the current draft + images + committed @mentions.
   * Async: reads mention files through the bridge with size/sensitive guards.
   * Zero-width marks become agent-facing `@` / `/` on the wire.
   * @returns blocks (undefined when only plain text and no attachments), wire text, notices.
   */
  const buildOutgoingBlocks = useCallback(async (): Promise<{
    blocks: ContentBlock[] | undefined;
    text: string;
    hint: string;
  }> => {
    const { text, paths } = prepareMentionSend(args.draft);
    const imageBlocks: ContentBlock[] = [];
    if (attachments.length > 0) {
      if (!imageCapable) {
        args.showNotice(imageUnsupportedMessage(), "warn");
      } else {
        for (const block of buildPromptBlocks(text, attachments)) {
          if (block.type === "image") {
            imageBlocks.push(block);
          }
        }
      }
    }

    if (paths.length === 0) {
      if (imageBlocks.length === 0) {
        return { blocks: undefined, text, hint: "" };
      }
      const blocks: ContentBlock[] = [];
      if (text.trim()) {
        blocks.push({ type: "text", text });
      }
      blocks.push(...imageBlocks);
      return { blocks, text, hint: "" };
    }

    const workspace = args.workspace?.trim() ?? "";
    const readFile = async (relPath: string): Promise<MentionFileReadResult> => {
      if (!args.readWorkspaceFile) {
        return {
          ok: false,
          bytes: 0,
          reason: "error",
          error: "bridge read unavailable",
        };
      }
      try {
        return await args.readWorkspaceFile(
          relPath,
          workspace || undefined,
        );
      } catch (e) {
        return {
          ok: false,
          bytes: 0,
          reason: "error",
          error: e instanceof Error ? e.message : String(e),
        };
      }
    };

    const toFileUri = (relPath: string): string => {
      if (!workspace) {
        return `file://${relPath}`;
      }
      const base = workspace.replace(/\\/g, "/").replace(/\/+$/, "");
      const rel = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
      return `file://${base}/${rel}`;
    };

    const assembled = await assembleMentionBlocks({
      text,
      paths,
      readFile,
      toFileUri,
      extraBlocks: imageBlocks,
    });
    const hint = formatMentionAttachmentHint(assembled.notices);
    return {
      blocks: assembled.blocks.length > 0 ? assembled.blocks : undefined,
      text: assembled.text,
      hint,
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
          args.showNotice(`Skipped: ${result.skipped.join(", ")}`, "warn");
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
    fileInputRef,
    imageCapable,
    acceptImageAttachment,
    buildOutgoingBlocks,
    handleFileInputChange,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    openFilePicker,
    removeAttachment,
    clearAttachments,
  };
}
