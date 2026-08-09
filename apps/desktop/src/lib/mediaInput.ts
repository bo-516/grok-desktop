/**
 * Image paste / drag helpers for ContentBlock image prompts (F-STREAM-07 / F-MEDIA-03).
 */

export type ImageAttachment = {
  mimeType: string;
  /** Base64 payload without data: prefix. */
  data: string;
  name?: string;
};

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
    binary += String.fromCharCode(bytes[i]!);
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
 * Whether agent capabilities claim image input (from initialize promptCapabilities).
 * Probe showed promptCapabilities.image === false for default models; UI must warn.
 * @param agentCapabilities From initialize result when available.
 */
export function agentSupportsImageInput(agentCapabilities: unknown): boolean {
  if (!agentCapabilities || typeof agentCapabilities !== "object") {
    return false;
  }
  const caps = agentCapabilities as {
    promptCapabilities?: { image?: boolean };
  };
  return caps.promptCapabilities?.image === true;
}

/**
 * Degradation message when user pastes an image but agent lacks image_input.
 */
export function imageUnsupportedMessage(): string {
  return (
    "This agent session does not advertise image input " +
    "(promptCapabilities.image=false). The image will not be sent."
  );
}
