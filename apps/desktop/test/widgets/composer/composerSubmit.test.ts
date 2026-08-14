/**
 * Submit orchestration: dock clear must not race ahead of optimistic paint.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContentBlock } from "@grok-desktop/acp-core";
import { runComposerSubmit } from "@/widgets/composer/composerSubmit";

describe("runComposerSubmit", () => {
  it("keeps attachments until after sendPrompt paints (no blank handoff frame)", async () => {
    const order: string[] = [];
    let resolveBuild!: (value: {
      blocks: ContentBlock[] | undefined;
      text: string;
      hint: string;
    }) => void;
    const buildDone = new Promise<{
      blocks: ContentBlock[] | undefined;
      text: string;
      hint: string;
    }>((resolve) => {
      resolveBuild = resolve;
    });

    runComposerSubmit({
      sentDraft: "see this",
      attachmentCount: 1,
      connectionMode: "live-bridge",
      streaming: false,
      waitingPermission: false,
      canSend: true,
      bridgeInfo: "",
      buildOutgoingBlocks: async () => {
        order.push("build-start");
        const result = await buildDone;
        order.push("build-end");
        return result;
      },
      sendPrompt: async (text, blocks) => {
        // Mirrors sessionStorePrompt: paint is synchronous before any await.
        order.push(`paint:${text}:${blocks?.some((b) => b.type === "image")}`);
        await Promise.resolve();
        order.push("send-settled");
        return true;
      },
      showNotice: () => {
        order.push("notice");
      },
      clearNotice: () => {
        order.push("clear-notice");
      },
      clearDraftIfUnchanged: () => {
        order.push("clear-draft");
      },
      restoreDraft: () => {
        order.push("restore-draft");
      },
      clearAttachments: () => {
        order.push("clear-attachments");
      },
      stopDictation: () => {
        order.push("stop-dictation");
      },
    });

    // While mention/image assembly is still pending, dock must still show thumbs.
    assert.deepEqual(order, ["stop-dictation", "clear-notice", "build-start"]);

    resolveBuild({
      text: "see this",
      hint: "",
      blocks: [
        { type: "text", text: "see this" },
        { type: "image", mimeType: "image/png", data: "abc" },
      ],
    });

    // Flush microtasks through sendPrompt.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assert.ok(
      order.indexOf("paint:see this:true") >= 0,
      `expected paint with image, order=${order.join(",")}`,
    );
    assert.ok(
      order.indexOf("paint:see this:true") < order.indexOf("clear-attachments"),
      `attachments must clear only after paint, order=${order.join(",")}`,
    );
    assert.ok(
      order.indexOf("paint:see this:true") < order.indexOf("clear-draft"),
      `draft must clear only after paint, order=${order.join(",")}`,
    );
    assert.ok(!order.includes("restore-draft"));
  });

  it("restores draft text when send fails after the dock was cleared", async () => {
    const order: string[] = [];
    runComposerSubmit({
      sentDraft: "hello",
      attachmentCount: 0,
      connectionMode: "live-bridge",
      streaming: false,
      waitingPermission: false,
      canSend: true,
      bridgeInfo: "Cannot connect to bridge",
      buildOutgoingBlocks: async () => ({
        blocks: undefined,
        text: "hello",
        hint: "",
      }),
      sendPrompt: async () => {
        order.push("paint");
        return false;
      },
      showNotice: (text) => {
        order.push(`notice:${text.slice(0, 20)}`);
      },
      clearNotice: () => undefined,
      clearDraftIfUnchanged: () => {
        order.push("clear-draft");
      },
      restoreDraft: () => {
        order.push("restore-draft");
      },
      clearAttachments: () => {
        order.push("clear-attachments");
      },
      stopDictation: () => undefined,
    });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assert.ok(order.indexOf("paint") < order.indexOf("clear-draft"));
    assert.ok(order.includes("restore-draft"));
  });

  it("does not send when tryLocalSlash handles /model or /effort", () => {
    const order: string[] = [];
    runComposerSubmit({
      sentDraft: "/model grok-4.6",
      attachmentCount: 0,
      connectionMode: "live-bridge",
      streaming: false,
      waitingPermission: false,
      canSend: true,
      bridgeInfo: "",
      tryLocalSlash: (draft) => {
        order.push(`local:${draft}`);
        return true;
      },
      buildOutgoingBlocks: async () => {
        order.push("build");
        return { blocks: undefined, text: "/model grok-4.6", hint: "" };
      },
      sendPrompt: async () => {
        order.push("send");
        return true;
      },
      showNotice: () => {
        order.push("notice");
      },
      clearNotice: () => {
        order.push("clear-notice");
      },
      clearDraftIfUnchanged: () => {
        order.push("clear-draft");
      },
      restoreDraft: () => {
        order.push("restore-draft");
      },
      clearAttachments: () => {
        order.push("clear-attachments");
      },
      stopDictation: () => {
        order.push("stop-dictation");
      },
    });
    assert.deepEqual(order, ["stop-dictation", "local:/model grok-4.6"]);
  });
});
