/**
 * Review-loop views: the diff row's comment gutter / slot only inside a
 * comment context, the review tray, and the restore trigger gate.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import type { DiffRow } from "@/lib/diffCore";
import type { ReviewComment } from "@/lib/reviewComments";
import { DiffRowView } from "@/widgets/preview/DiffRowView";
import { DiffCommentFileContext, ReviewTrayView, type DiffCommentFileModel } from "@/widgets/review";
import { disabledReasonFor } from "@/widgets/turnRewind";

const ROW: DiffRow = { type: "add", text: "const a = 1;", newNo: 4 };

const COMMENT: ReviewComment = {
  id: "c1",
  path: "src/a.ts",
  side: "new",
  startLine: 3,
  endLine: 4,
  excerpt: [{ mark: "+", text: "const a = 1;" }],
  excerptOmitted: 0,
  body: "Use a constant name",
  createdAt: 0,
};

/**
 * File model with overrides.
 * @param patch Fields to replace.
 */
function model(patch: Partial<DiffCommentFileModel> = {}): DiffCommentFileModel {
  return {
    path: "src/a.ts",
    selectedKeys: new Set<string>(),
    composerKey: "",
    composerLabel: "",
    comments: [],
    onGutter: () => undefined,
    onCancel: () => undefined,
    onSubmit: () => undefined,
    onRemove: () => undefined,
    ...patch,
  };
}

/**
 * Render a row, optionally inside a comment context.
 * @param value Context value (undefined → no provider).
 */
function renderRow(value?: DiffCommentFileModel): string {
  const row = createElement(DiffRowView, { row: ROW });
  return renderToStaticMarkup(
    value ? createElement(DiffCommentFileContext.Provider, { value }, row) : row,
  );
}

describe("DiffRowView comment chrome", () => {
  it("has no gutter outside the git change list", () => {
    const html = renderRow();
    assert.doesNotMatch(html, /diff-comment-add/);
    assert.doesNotMatch(html, /review-comment/);
  });

  it("shows the gutter, selection wash, saved comment and composer in context", () => {
    const key = "add::4";
    const html = renderRow(
      model({ selectedKeys: new Set([key]), composerKey: key, composerLabel: "src/a.ts:3-4", comments: [COMMENT] }),
    );
    assert.match(html, /aria-label="Comment on this line"/);
    assert.match(html, /diff-comment-wash/);
    assert.match(html, /data-kind="review-comment"/);
    assert.match(html, /Use a constant name/);
    assert.match(html, /Comment on src\/a\.ts:3-4/);
  });
});

describe("ReviewTrayView", () => {
  const base = {
    comments: [COMMENT],
    sending: false,
    turnBusy: false,
    notice: "",
    onRemove: () => undefined,
    onClear: () => undefined,
    onSend: () => undefined,
  };

  it("is hidden with nothing to show", () => {
    assert.equal(renderToStaticMarkup(createElement(ReviewTrayView, { ...base, comments: [] })), "");
  });

  it("lists comments and labels send vs queue", () => {
    const idle = renderToStaticMarkup(createElement(ReviewTrayView, base));
    assert.match(idle, /src\/a\.ts:3-4/);
    assert.match(idle, /Send to agent/);
    const busy = renderToStaticMarkup(createElement(ReviewTrayView, { ...base, turnBusy: true }));
    assert.match(busy, /Queue for agent/);
    assert.match(busy, /sends after the current turn/);
  });

  it("keeps a send notice visible after the list empties", () => {
    const html = renderToStaticMarkup(createElement(ReviewTrayView, { ...base, comments: [], notice: "Sent to the agent." }));
    assert.match(html, /Sent to the agent\./);
    assert.doesNotMatch(html, /Send to agent/);
  });
});

describe("disabledReasonFor", () => {
  it("gates restore on a live, idle session", () => {
    assert.match(disabledReasonFor("", false), /Start the chat/);
    assert.match(disabledReasonFor("s1", true), /current turn/);
    assert.equal(disabledReasonFor("s1", false), "");
  });
});
