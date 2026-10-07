/**
 * Prompt content blocks and the ordered timeline rows a session renders.
 * Row provenance (`origin` / `agentConfirmed` / `agentEchoAcc`) drives
 * seed-vs-replay claiming so resume never double-appends history.
 */

/**
 * Prompt content block (subset of ACP ContentBlock).
 *
 * Embedded `resource` matches MCP EmbeddedResource shape confirmed by live
 * `grok agent stdio` probe (type:"resource" + nested resource.uri/text/mimeType).
 * Flat fields without the `resource` wrapper are rejected by the agent.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name?: string }
  | {
      type: "resource";
      resource: {
        /** file:// URI of the attached path (workspace-relative origin). */
        uri: string;
        /** Snapshot of file body at send time (UTF-8 text only). */
        text: string;
        mimeType?: string;
      };
    }
  | { type: "image"; mimeType: string; data: string };

/**
 * Provenance of a user timeline row.
 * - `local`: optimistic `appendUserPrompt` (has `clientPromptId`)
 * - `seed`: restored from cached transcript before agent replay
 * - `agent`: created only from `user_message_chunk` with no pending local/seed row
 */
export type UserMessageOrigin = "local" | "seed" | "agent";

/**
 * Provenance of agent / thought timeline rows (seed vs live).
 * - `seed`: restored from cached transcript before session/load replay
 * - `agent`: created from live or post-claim streaming chunks
 */
export type AgentContentOrigin = "seed" | "agent";

/**
 * One ordered row of the session timeline, discriminated by `kind`.
 * Tool rows only reference a card by toolCallId (body lives in
 * SessionState.toolCalls); error rows carry a display message only.
 */
export type TimelineItem =
  | {
      kind: "user";
      id: string;
      blocks: ContentBlock[];
      /**
       * Client-assigned prompt identity for optimistic rows.
       * Agent replay matches unconfirmed rows by order + this id, not string equality alone.
       */
      clientPromptId?: string;
      /** How this row was first created; missing is treated as seed-compatible for resume. */
      origin?: UserMessageOrigin;
      /**
       * True once agent has fully echoed this prompt (live or session/load replay).
       * Further matching `user_message_chunk` events for this slot are discarded.
       */
      agentConfirmed?: boolean;
      /**
       * Accumulated agent-echo text while chunked replay of this row is in progress.
       * Used only for progress/confirm; authoritative body stays in `blocks` for local/seed.
       */
      agentEchoAcc?: string;
    }
  | {
      kind: "agent";
      id: string;
      text: string;
      /** How this row was first created; seed rows are claimed on session/load replay. */
      origin?: AgentContentOrigin;
      /**
       * True once session/load (or live) has fully echoed this seed agent body.
       * Further matching chunks for this slot are discarded instead of double-appending.
       */
      agentConfirmed?: boolean;
      /** Accumulated replay echo while claiming a seed agent row. */
      agentEchoAcc?: string;
    }
  | {
      /** Expandable reasoning fragment; body text is never mixed into agent messages. */
      kind: "thought";
      id: string;
      text: string;
      /** First render should be collapsed; the UI may toggle expand state locally. */
      collapsed: boolean;
      /** Local timestamp when the first thought chunk arrived; if missing, UI shows only Thought. */
      startedAt: number;
      /** Written when the next non-thought event arrives or the turn ends; used to display duration. */
      completedAt?: number;
      /** How this row was first created; seed rows are claimed on session/load replay. */
      origin?: AgentContentOrigin;
      /**
       * True once session/load has fully echoed this seed thought body.
       * Prevents pure-append duplication on resume.
       */
      agentConfirmed?: boolean;
      /** Accumulated replay echo while claiming a seed thought row. */
      agentEchoAcc?: string;
    }
  | { kind: "tool"; id: string; toolCallId: string }
  | { kind: "error"; id: string; message: string };
