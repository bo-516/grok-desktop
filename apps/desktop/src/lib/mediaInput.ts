/**
 * Image paste / drag helpers for ContentBlock image prompts (F-STREAM-07 / F-MEDIA-03).
 * Also owns attachment strip preview rules: browser-inline thumbs vs external open.
 */

export type ImageAttachment = {
  mimeType: string;
  /** Base64 payload without data: prefix. */
  data: string;
  name?: string;
};

/**
 * MIME types browsers reliably decode for <img> / lightbox (not HEIC/TIFF/JXL).
 * Unknown image/* still attaches for send; strip falls back to external open.
 */
const BROWSER_PREVIEWABLE_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/avif",
]);

/**
 * Normalize a Content-Type / file.type string for Set lookup.
 * @param mimeType Raw mime (may include `;charset=…`).
 * @returns Lowercased type without parameters.
 */
function normalizeMimeType(mimeType: string): string {
  return mimeType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
}

/**
 * Whether the browser can show this mime as an inline <img> / lightbox.
 * @param mimeType Attachment mimeType.
 * @returns true for common web image formats only.
 */
export function isBrowserPreviewableImage(mimeType: string): boolean {
  return BROWSER_PREVIEWABLE_IMAGE_MIMES.has(normalizeMimeType(mimeType));
}

/**
 * Build a data-URL for a base64 image attachment (thumb / lightbox src).
 * @param att Attachment with mime + raw base64 (no data: prefix).
 * @returns URL string for <img src>, or empty when payload is missing.
 */
export function attachmentPreviewSrc(att: ImageAttachment): string {
  if (!att.data) {
    return "";
  }
  return `data:${att.mimeType};base64,${att.data}`;
}

/**
 * Whether the composer strip can render an inline thumbnail for this attachment.
 * Requires both a payload and a browser-decodable mime.
 * @param att Pending composer attachment.
 * @returns true when <img> thumb + in-app lightbox are appropriate.
 */
export function canInlinePreviewAttachment(att: ImageAttachment): boolean {
  return Boolean(att.data) && isBrowserPreviewableImage(att.mimeType);
}

/**
 * Decode base64 attachment bytes into a Blob for object-URL open/download.
 * @param att Attachment with mime + raw base64.
 * @returns Blob, or null when data is empty/invalid.
 */
function attachmentToBlob(att: ImageAttachment): Blob | null {
  if (!att.data) {
    return null;
  }
  try {
    const binary = atob(att.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], {
      type: att.mimeType || "application/octet-stream",
    });
  } catch {
    return null;
  }
}

/**
 * Open an attachment with the OS/browser default handler (Preview, Photos, etc.).
 * Uses a blob object URL — data: URLs break for large files and some handlers.
 * Falls back to a same-tab download when popups are blocked.
 * @param att Attachment to open; no-op when payload is missing or corrupt.
 * @returns true when an open or download was started; false when nothing ran.
 */
export function openAttachmentExternally(att: ImageAttachment): boolean {
  const blob = attachmentToBlob(att);
  if (!blob) {
    return false;
  }
  const url = URL.createObjectURL(blob);
  const revokeLater = () => {
    // Delay so the OS viewer / download pipeline can finish reading the blob.
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) {
    revokeLater();
    return true;
  }
  // Popup blocked: force a download so the user can open with system Preview.
  const anchor = document.createElement("a");
  const label = att.name?.trim() || "attachment";
  anchor.href = url;
  anchor.download = label;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  revokeLater();
  return true;
}

/**
 * Read a File/Blob as base64 image attachment.
 * @param file Browser File from paste or drop.
 * @returns Attachment or null when not an image.
 */
export async function fileToImageAttachment(
  file: File | Blob,
): Promise<ImageAttachment | null> {
  const mimeType =
    "type" in file && file.type
      ? file.type
      : "application/octet-stream";
  if (!mimeType.startsWith("image/")) {
    return null;
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i];
    if (code === undefined) {
      continue;
    }
    binary += String.fromCharCode(code);
  }
  const data = btoa(binary);
  const name = "name" in file && typeof file.name === "string" ? file.name : undefined;
  return { mimeType, data, name };
}

/**
 * Build ACP content blocks for text + optional images.
 * @param text User text.
 * @param images Optional attachments.
 */
export function buildPromptBlocks(
  text: string,
  images: ImageAttachment[] = [],
): Array<
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
> {
  const blocks: Array<
    | { type: "text"; text: string }
    | { type: "image"; mimeType: string; data: string }
  > = [];
  if (text.trim()) {
    blocks.push({ type: "text", text });
  }
  for (const img of images) {
    blocks.push({
      type: "image",
      mimeType: img.mimeType,
      data: img.data,
    });
  }
  return blocks;
}

/**
 * Whether the composer should offer image attach/send for this agent session.
 *
 * Live **grok-build** still advertises `promptCapabilities.image: false` on
 * `initialize`, but `session/prompt` accepts `{ type: "image", mimeType, data }`
 * ContentBlocks (verified on current CLI: `user_message_chunk` echoes the image;
 * invalid sizes may emit `image_dropped`, e.g. below 8×8). Prefer **behavior over
 * advertisement** — do not gate paste / + / send on that false flag alone.
 *
 * Product path is live-bridge-only, so missing caps (pre-handshake) also allow
 * attach; a future non-vision agent can be tightened if we ever multi-agent.
 *
 * @param agentCapabilities From initialize `agentCapabilities` when available.
 * @returns true when the UI should stage and send image ContentBlocks.
 */
export function agentSupportsImageInput(agentCapabilities: unknown): boolean {
  if (!agentCapabilities || typeof agentCapabilities !== "object") {
    // Pre-handshake / empty snapshot: product is live grok-build — allow attach.
    return true;
  }
  const caps = agentCapabilities as {
    promptCapabilities?: { image?: boolean };
    /** grok-build always sets loadSession; used as a soft agent fingerprint. */
    loadSession?: boolean;
  };
  // Explicit true, or grok-build shape (loadSession) despite a false advertisement.
  if (
    caps.promptCapabilities?.image === true ||
    caps.loadSession === true
  ) {
    return true;
  }
  // Unknown agent without loadSession and without image:true — keep gated.
  return false;
}

/**
 * Copy when a non-vision agent path refuses images (rare in live grok-build).
 * Kept for call sites that still branch on !imageCapable.
 */
export function imageUnsupportedMessage(): string {
  return (
    "This agent session does not support image input. " +
    "The image was kept for preview only and will not be sent."
  );
}
