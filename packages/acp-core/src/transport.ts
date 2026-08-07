/**
 * ACP line transport adapter.
 * Turns chunk-oriented streams (e.g. Node child process) into complete NDJSON lines required by the codec.
 */

import { splitNdjsonBuffer } from "./codec.js";

/** Minimal bidirectional transport contract; implementer bugs prevent ACP requests from being delivered or responses from being consumed. */
export type AcpTransport = {
  write: (line: string) => void;
  onLine: (handler: (line: string) => void) => void;
  onClose?: (handler: (code: number | null) => void) => void;
  onStderr?: (handler: (chunk: string) => void) => void;
  dispose?: () => void;
};

/**
 * Wrap a set of callbacks as an AcpTransport shared by stdio and in-memory test channels.
 * @param opts Low-level write and subscribe functions; missing write/subscribe is blocked at the TypeScript layer.
 * @returns Lightweight adapter matching the protocol AcpClient expects.
 */
export function createLineTransport(opts: {
  write: (data: string) => void;
  subscribeLines: (callback: (line: string) => void) => void;
  onClose?: (callback: (code: number | null) => void) => void;
  onStderr?: (callback: (chunk: string) => void) => void;
  dispose?: () => void;
}): AcpTransport {
  return {
    write: opts.write,
    onLine: opts.subscribeLines,
    onClose: opts.onClose,
    onStderr: opts.onStderr,
    dispose: opts.dispose,
  };
}

/**
 * Create a stdout chunk framer so partial JSON lines are never handed to the decoder early.
 * @param onLine Consumer for each complete NDJSON line; empty lines are kept and the codec decides whether to ignore them.
 * @returns Handler that can be registered directly on a Node Readable `data` event.
 */
export function createStdoutLineSplitter(
  onLine: (line: string) => void,
): (chunk: string | Buffer) => void {
  let buffer = "";

  return (chunk) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const framed = splitNdjsonBuffer(buffer);
    buffer = framed.rest;
    for (const line of framed.lines) {onLine(line);}
  };
}
