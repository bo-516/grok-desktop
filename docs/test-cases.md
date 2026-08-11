# grok-desktop Complete Test Cases

> **Product**: Desktop ACP client for `grok-build` (`grok agent stdio`)  
> **Principle**: UI only renders the ACP event stream; intelligence lives in the upstream CLI; **product path must not use mock / offline fixtures**  
> **Scope**: Current M0/M1 implemented surface + MVP acceptance from design docs (`docs/design/ui-ux-agent-client.md`, `todo.md`)  
> **Supplement**: §23 maps real-world Codex / Claude Code–style agent client experience and pain points from X/Twitter onto grok-desktop functional acceptance  
> **Date**: 2026-08-07

---

## 0. Document notes

### 0.1 Test layers

| Layer | Code | How to run | Mock allowed? | Purpose |
|---|---|---|---|---|
| Protocol / pure-function unit | **U** | `npm run test` / `npm run test:all` | ✅ In-process `createMockAcpPair` / fixture only | codec, timeline reducer, catalog logic |
| UI structure / constraint unit | **S** | `npm run test -w @grok-desktop/desktop` | File-level assertions; no agent spawn | Shell regions, live-only, color tokens |
| Bridge unit | **B** | bridge package tests (TBD) | May fake fs/path data | Workspace enumeration, path safety |
| Live handshake | **L0** | `npm run m0:live` | ❌ | initialize → auth → session/new → prompt |
| Live e2e | **L1** | `npm run demo:e2e` | ❌ | Read files / small edits / tools / optional subagent |
| UI manual / browser acceptance | **M** | `npm run bridge` + `npm run dev` | ❌ | Session rail, composer, permissions, disconnect |
| Regression checklist | **R** | Before release / merge | Run by layer | Overall acceptance |

### 0.2 Priority

| Priority | Meaning |
|---|---|
| **P0** | Blocks release; failure = product unusable or hard-constraint violation |
| **P1** | Core experience; should be green before merge |
| **P2** | Important enhancement / edge case |
| **P3** | Polish / future (M2+) |

### 0.3 Case status (relative to current repo)

| Status | Meaning |
|---|---|
| **Covered** | Automated test or script already exists |
| **Partial** | Related tests exist but incomplete |
| **TBD** | Documented requirement; code coverage missing |
| **Manual** | Suited to human / browser acceptance |

### 0.4 Shared prerequisites

| Code | Condition |
|---|---|
| **ENV-CLI** | `grok` on PATH or `~/.grok/bin/grok`; `grok login` done or `XAI_API_KEY` configured |
| **ENV-NODE** | Node.js ≥ 20; `npm install` complete |
| **ENV-BRIDGE** | `npm run bridge` running; default `ws://127.0.0.1:8765`; cwd=`demo/` |
| **ENV-UI** | `npm run dev`; open http://localhost:8172 |
| **ENV-DEMO** | `demo/` workspace exists and is writable; acceptance write ops must not pollute `packages/` |

### 0.5 Product hard constraints (no layer may violate)

| ID | Constraint | Acceptance |
|---|---|---|
| HC-01 | Product / UI / acceptance paths **must** connect real `grok agent stdio` | No mock entry on the main path |
| HC-02 | **Forbidden**: mock agent, offline fixture, fake echo as a session | `App` / `sessionStore` have no `createMockAcpPair` or `startMockAgent` |
| HC-03 | UI default and send only allow `live-bridge`; if bridge is unavailable, **fail** — no silent mock fallback | Disconnect shows banner + connect guidance; no fake session |
| HC-04 | Unit-test mocks are **only** for protocol/codec isolation; must not wire into `npm run dev` | `ui-surfaces` + code review |
| HC-05 | Colors only via `defineColor.css` tokens | Layout CSS has no hex; TSX has no color literals |

---

## 1. Protocol layer · Codec (`packages/acp-core`)

> Module: `codec.ts` · Layer U · Existing `test/codec.test.ts`

| ID | Title | Priority | Layer | Status | Pre | Steps | Expected |
|---|---|---|---|---|---|---|---|
| TC-CODEC-01 | Encode request as single-line NDJSON | P0 | U | Covered | — | `encodeRequest(method, params, id)` | Output is `JSON.parse`-able; includes `jsonrpc/id/method/params`; ends with `\n` or can be split by splitter |
| TC-CODEC-02 | Encode notification (no id) | P0 | U | Covered | — | `encodeNotification("session/cancel", …)` | No `id` field |
| TC-CODEC-03 | Encode success / error response | P0 | U | Covered | — | `encodeResponse` | Correctly carries `result` or `error` |
| TC-CODEC-04 | Decode valid JSON-RPC line | P0 | U | Covered | — | `decodeLine` valid request/response/notif | Returns corresponding message |
| TC-CODEC-05 | Decode illegal line without crashing | P0 | U | Covered | — | Empty line, truncated JSON, non-object | Returns error/ignore semantics; does not throw uncaught to upper layers |
| TC-CODEC-06 | `classifyMessage` three-way branch | P0 | U | Covered | — | request / response / notification | Classification correct for read-loop dispatch |
| TC-CODEC-07 | NDJSON buffer split (sticky/half packets) | P0 | U | Covered | — | `splitNdjsonBuffer` multi-chunk input | Complete lines extracted; remainder stays in buffer |
| TC-CODEC-08 | Unknown fields kept loosely | P1 | U | Partial | — | Message with extra `_meta` / unknown keys | Codec does not drop critical fields; does not fail on unknown keys |

---

## 2. Protocol layer · Timeline / SessionUpdate

> Modules: `timeline.ts`, `sessionLifecycle.ts`, `sessionMetadata.ts`, `sessionTitle.ts`  
> Layer U · Existing `test/timeline.test.ts`

### 2.1 Tool patch-merge (easiest place to get wrong)

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-TL-01 | `patchToolCard` status-only update does not wipe content | P0 | U | Covered | Card with diff content → status-only patch | `content` / `title` / `kind` retained; `status` updated |
| TC-TL-02 | Status-only `tool_call_update` after `tool_call` | P0 | U | Covered | apply tool_call → apply status completed | Timeline has exactly 1 tool pointer; map retains content |
| TC-TL-03 | Duplicate `tool_call` for same id does not duplicate timeline item | P1 | U | TBD | Same `toolCallId` twice as tool_call | Deduped pointer or stable merge strategy consistent |
| TC-TL-04 | Update for unknown `toolCallId` | P1 | U | TBD | Update before call, or update only | May create placeholder or safely ignore; no unhandled throw |
| TC-TL-05 | Content merge strategy | P1 | U | TBD | update carries new content | New content overwrite/merge matches implementation contract; path not lost |

### 2.2 Text / thought stream

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-TL-10 | `agent_message_chunk` merges into one agent item | P0 | U | Covered | Two consecutive chunks | Single timeline agent; `lastAgentText` concatenated |
| TC-TL-11 | `agent_thought_chunk` merges and defaults collapsed | P0 | U | Covered | Consecutive thought | `kind=thought`, `collapsed=true`; body not in agent text |
| TC-TL-12 | Thought timing completes when agent body starts | P1 | U | Covered | thought → agent_message | `startedAt`/`completedAt` set |
| TC-TL-13 | Status → idle after turn settle | P0 | U | Covered | markPromptSettled | status idle; thought blocks may finalize after stream ends |
| TC-TL-14 | `user_message_chunk` history replay | P1 | U | TBD | session/load replays user chunks | User bubbles append/merge correctly |
| TC-TL-15 | Unknown `sessionUpdate` variant | P1 | U | TBD | Pass unknown discriminant | Do not write error that poisons session **or** degrade to error card without crash (match product contract) |

### 2.3 Plan / metadata / commands

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-TL-20 | `plan` whole-package replace | P0 | U | Covered | plan A → plan A+B | Final entries equal second full list |
| TC-TL-21 | `session_info_update` changes title; not on timeline | P0 | U | Covered | title / updatedAt / null clear | title updates; timeline has no error |
| TC-TL-22 | `config_option_update` not on timeline | P1 | U | Covered | push configOptions | state has config; timeline empty |
| TC-TL-23 | `available_commands_update` normalization | P0 | U | Covered | duplicate name, illegal name | Dedup + drop illegal; keep hint/_meta |
| TC-TL-24 | `current_mode_update` normalizes mode | P1 | U | TBD | ask/plan/build and unknown values | Map to `AgentMode`; unknown falls back safely |
| TC-TL-25 | `extractSessionUpdate` reads nested update | P0 | U | Covered | params with sessionId+update | Correctly extracts SessionUpdate |

### 2.4 Lifecycle and permission shaping

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-LC-01 | appendUserPrompt → streaming | P0 | U | Covered | Enqueue user block | timeline has user; status streaming |
| TC-LC-02 | markPromptStarted / Settled | P0 | U | Covered | start → settle | streaming → idle |
| TC-LC-03 | waiting_permission enter/exit | P0 | U | Covered | setPending → clear | status and pendingPermission stay in sync |
| TC-LC-04 | markDisconnected | P0 | U | Covered | disconnect | status disconnected |
| TC-LC-05 | shapePermissionRequest default four options | P0 | U | Covered | No options in input | allow_once / allow_always / deny / deny_and_stop |
| TC-LC-06 | buildPermissionOutcome shape | P0 | U | Covered | optionId | `{ outcome: { outcome:"selected", optionId } }` |
| TC-LC-07 | Quiet-window settle rule | P0 | U | Partial(client) | N ms with no update after prompt returns | Leave streaming only then (matches `settleQuietMs`) |

### 2.5 Session title

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-TITLE-01 | Weak title detection (Chat id placeholder) | P1 | U | Covered(catalog) | id-shaped title | `isWeakSessionTitle` true |
| TC-TITLE-02 | Prefer user message as title | P1 | U | Covered | pickSessionTitle | First user sentence beats weak id |
| TC-TITLE-03 | Agent `session_info` title wins | P1 | U | Covered | Has agent title | Not overwritten by weak backfill |

---

## 3. Protocol layer · AcpClient

> Module: `client.ts` · Layer U (mock protocol-only) · Existing `test/client.test.ts`  
> **Note**: mocks must not enter product UI.

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-CLI-01 | Handshake initialize → authenticate → session/new | P0 | U | Covered | mock pair handshake | Returns sessionId; models readable |
| TC-CLI-02 | Prompt stream: text + thought + tool + plan | P0 | U | Covered | prompt + whenIdle | lastAgentText matches; kinds on timeline; tool completed with content retained |
| TC-CLI-03 | autoPermission auto-selects allow_once | P0 | U | Covered | emitPermission + auto option | Does not stick on waiting_permission |
| TC-CLI-04 | cancel does not throw | P1 | U | Covered | cancel(sessionId) | Notification sent; client can dispose |
| TC-CLI-05 | session_info_update has no unknown-error card | P0 | U | Covered | dispatch session_info | title set; no error timeline item |
| TC-CLI-06 | Still receives late tool update after cancel | P1 | U | TBD | cancel mid-streaming; then tool_call_update | State machine allows update; card not lost |
| TC-CLI-07 | session/load history replay | P0 | U/L1 | TBD | load existing sessionId | timeline replayed; id matches catalog |
| TC-CLI-08 | Auth failure has clear error | P0 | L0 | TBD | no token / wrong method | Error observable; no false success |
| TC-CLI-09 | Child process exit → disconnected | P0 | U/L0 | TBD | kill agent | onState / markDisconnected |
| TC-CLI-10 | Agent reverse fs/read is answerable | P0 | L1 | Partial(e2e) | agent reads demo file | bridge/client returns content |
| TC-CLI-11 | Agent reverse path out-of-bounds rejected | P0 | B/L1 | TBD | path outside workspace | Throw/reject; no disk read |

---

## 4. Bridge (`apps/bridge`)

> Modules: `server.ts`, `spawnGrok.ts`, `workspaceEntries.ts`, `demo-e2e.ts`

### 4.1 Process and session

| ID | Title | Priority | Layer | Status | Pre | Steps | Expected |
|---|---|---|---|---|---|---|---|
| TC-BR-01 | spawn real `grok agent stdio` | P0 | L0/L1 | Covered | ENV-CLI | Start bridge / m0 / e2e | Child is real CLI, not mock |
| TC-BR-02 | Default cwd = `demo/` | P0 | L1 | Covered | ENV-CLI | No BRIDGE_CWD | Workspace is demo |
| TC-BR-03 | WebSocket hello | P0 | M/B | Manual | ENV-BRIDGE | UI connects | Receives `{type:hello, cwd, port}` |
| TC-BR-04 | start + forceNew → session/new | P0 | M | Manual | ENV-BRIDGE+UI | Click “New chat” | New sessionId; catalog gains entry |
| TC-BR-05 | start + resumeId → session/load | P0 | M | Manual | Has history session | Click sidebar session | Timeline restored; no new ghost id |
| TC-BR-06 | Cold start does not blindly session/new | P0 | M | Manual | catalog has last | Refresh page | resume last or reconnect; no `Chat 019…` ghost |
| TC-BR-07 | prompt / cancel / permission forwarding | P0 | M | Manual | live | Send, Stop, click permission | bridge forwards to agent; state broadcast |
| TC-BR-08 | BRIDGE_ALWAYS_APPROVE=1 | P1 | L1 | Covered(e2e) | — | demo:e2e | Tool turns complete without UI |
| TC-BR-09 | stderr broadcast | P1 | M | Manual | — | Auth/sandbox errors | UI/logs show stderr |
| TC-BR-10 | Repeat start disposes old process first | P0 | B/L0 | TBD | — | start twice in a row | Old child exits; no zombies |

### 4.2 Workspace entries (@ completion data source)

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-BR-20 | `list_workspace_entries` returns real paths | P0 | B | TBD | query empty/keyword | entries from real cwd, not mock list |
| TC-BR-21 | Respects ignore (node_modules/.git) | P1 | B | TBD | enumerate | Excludes node_modules and similar noise |
| TC-BR-22 | Paths stay relative to workspace | P1 | B | TBD | — | UI can insert usable relative paths |
| TC-BR-23 | Acceptable performance on huge trees | P2 | B | TBD | large repo | Timeout/truncate strategy is clear |

### 4.3 FS reverse-request safety

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-BR-30 | read limited under cwd | P0 | B | Partial | `../` escape | Reject |
| TC-BR-31 | write limited under cwd | P0 | B | Partial | write outside packages | Reject; e2e does not pollute other repo trees |
| TC-BR-32 | mkdir parents before write | P2 | B | TBD | nested new path | Success or clear error |

---

## 5. Desktop Store · Session Catalog

> Modules: `sessionCatalog.ts`, `sessionStoreSupport.ts` · Existing `sessionCatalog.test.ts`

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-CAT-01 | projectNameFromWorkspace basename | P1 | U | Covered | path input | Project name = last segment |
| TC-CAT-02 | upsert does not overwrite rich timeline with empty handshake | P0 | U | Covered | rich session + empty seed | History timeline retained |
| TC-CAT-03 | rehydrate weak title → user message | P1 | U | Covered | Chat id title | Corrected to content title |
| TC-CAT-04 | rehydrate keeps agent session_info title | P1 | U | Covered | has agent title | Not overwritten |
| TC-CAT-05 | pruneEmptyWeakSessions removes ghosts | P0 | U | Covered | empty weak session | Removed from catalog |
| TC-CAT-06 | groupSessionsByProject | P1 | U | Covered | multi workspace | Grouped by project |
| TC-CAT-07 | localStorage read/write v1 key | P0 | U | Partial | load/save | key=`grok-desktop.session-catalog.v1`; corrupt JSON degrades safely |
| TC-CAT-08 | formatRelativeTime | P2 | U | TBD | boundary now/past | Relative time copy is reasonable |
| TC-CAT-09 | recordToSessionState round-trip | P1 | U | TBD | record → state | Fields complete and renderable |

---

## 6. Desktop Store · SessionStore / Live Bridge

> Modules: `sessionStore.ts`, `liveBridge.ts` · Existing `sessionStore.test.ts` (patch path)

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-ST-01 | Tool fixture goes through production applySessionUpdate | P0 | U | Covered | applyToolFixtureThroughCore | Same path as core; no dual implementation |
| TC-ST-02 | connectionMode three states | P0 | M | Manual | disconnect→connecting→live | `disconnected` / `connecting` / `live-bridge` |
| TC-ST-03 | send fails without bridge and keeps draft | P0 | M | Manual | stop bridge, send message | returns false; input not cleared |
| TC-ST-04 | successful send clears corresponding draft | P1 | M | Manual | send | Clear only if draft was not edited again |
| TC-ST-05 | user typing during send is not cleared | P1 | M | Manual | edit draft immediately after send | New draft kept (useComposerWidget contract) |
| TC-ST-06 | selectSession race | P0 | U/M | TBD | quick A→B switch while A load arrives late | selectSeq ensures current view not overwritten |
| TC-ST-07 | viewing ≠ active does not steal focus | P1 | M | TBD | background session pushes state | Only follow current viewing/active |
| TC-ST-08 | only newSession uses forceNew | P0 | M | Manual | new chat vs reconnect | session/new only for new chat |
| TC-ST-09 | reconnect does not create new id | P0 | M | Manual | after disconnect “Connect live grok” | load current/last |
| TC-ST-10 | removeSession | P1 | M | TBD | delete from sidebar | catalog updates; if current, switch away |
| TC-ST-11 | respondPermission forwards optionId | P0 | M | Manual | click permission button | bridge `permission` message |
| TC-ST-12 | cancelTurn forwards | P0 | M | Manual | Stop | bridge `cancel` |
| TC-ST-13 | setMode local cycle Ask/Plan/Build | P1 | M | Manual | click mode chip | UI switches; later agent update may override |
| TC-ST-14 | listWorkspaceEntries via live handle | P0 | M | Manual | type `@` | request bridge; results feed completion |
| TC-ST-15 | store must not reference mock | P0 | S | Covered | scan sessionStore | no createMockAcpPair |

---

## 7. UI · Shell and layout

> Modules: `App.tsx`, styles · Existing `ui-surfaces.test.ts`

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-UI-01 | Three-region shell: SessionRail / Timeline / Composer | P0 | S/M | Covered | open UI | left rail + main timeline + bottom input |
| TC-UI-02 | top-nav title / workspace / sync chip | P1 | M | Manual | live connected | shows session title, short path, synced/offline |
| TC-UI-03 | Chat / Plan tabs | P1 | M | Manual | when plan present | auto-open plan; can close; count shown |
| TC-UI-04 | mode chip styles ask/plan/build | P1 | M | Manual | switch mode | matching class / copy |
| TC-UI-05 | Offline banner | P0 | M | Manual | stop bridge | hints `npm run bridge` + can connect; history still visible |
| TC-UI-06 | streaming strip above composer | P1 | M | Manual | generating | pulse orb + shimmering verb + current step + elapsed clock; Stop available (button or Esc) |
| TC-UI-07 | waiting_permission banner + modal | P0 | M | Manual | permission request | warning bar + modal |
| TC-UI-08 | no mock entry copy | P0 | S | Covered | source scan | no Mock agent / fixture buttons |
| TC-UI-09 | colors only defineColor tokens | P0 | S | Covered | layout css | no hex; has `--color-bg-app` etc. |
| TC-UI-10 | TSX no color literals / banned color utilities | P0 | S | TBD | grep tsx | matches AGENTS color rules |

---

## 8. UI · Session Rail

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-RAIL-01 | side-nav + project grouping | P0 | S/M | Covered | multi-session different cwd | grouped display |
| TC-RAIL-02 | “New chat” | P0 | M | Manual | click | forceNew; empty timeline ready for input |
| TC-RAIL-03 | click session selectSession | P0 | M | Manual | click history | main pane switches; triggers load/resume |
| TC-RAIL-04 | status pip (idle/streaming/…) | P1 | M | TBD | each status | run state visible in list |
| TC-RAIL-05 | relative time / weak titles not shown | P1 | M | Manual | new session with user message | readable title, not Chat id |
| TC-RAIL-06 | connect-live entry (when offline) | P0 | M | Manual | offline | footer/entry can reconnect |
| TC-RAIL-07 | empty catalog first launch | P1 | M | Manual | clear localStorage | reconnect or empty state can create session |

---

## 9. UI · Timeline

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-TM-01 | render user / agent / thought / tool | P0 | S/M | Covered | one full turn | data-kind complete |
| TC-TM-02 | agent streaming append without full-table flash | P1 | M | Manual | long stream | last block grows; finished blocks stay stable |
| TC-TM-03 | thought default collapsed, expandable | P1 | M | Manual | has thought | collapse label; expand shows full text; may show duration |
| TC-TM-04 | tool card kind differences | P1 | M | Manual | read/edit/execute | title/status/summary; edit shows diff cues |
| TC-TM-05 | tool status pending→in_progress→completed/failed | P0 | M | Manual | watch tool turn | card updates in place; no stacked duplicates |
| TC-TM-06 | error item display | P1 | M | TBD | inject error | readable error; no white screen |
| TC-TM-07 | empty session empty state | P2 | M | Manual | new chat | no fake messages; composer usable |
| TC-TM-08 | long session scroll | P2 | M | Manual | many turns | scrollable; focus/bottom-align strategy reasonable |

---

## 10. UI · Tool Card / Diff (MVP)

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-TOOL-01 | ToolCardView data-kind=tool | P0 | S | Covered | — | structure present |
| TC-TOOL-02 | show title / kind / status | P0 | M | Manual | real tool | fields visible |
| TC-TOOL-03 | edit + diff content summary | P1 | M | Partial | demo e2e edit file | path / change cues visible |
| TC-TOOL-04 | full diff review (side-by-side/hunk) | P2 | M | TBD(M3) | Open review | designed; implementation may follow later |
| TC-TOOL-05 | execute output collapsible | P2 | M | TBD | shell tool | long output collapsible |

---

## 11. UI · Permission

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-PERM-01 | modal appears for pendingPermission | P0 | S/M | Covered | permission request | dialog + tool title |
| TC-PERM-02 | four options clickable | P0 | S/M | Covered | allow_once / always / deny / deny_and_stop | respondPermission carries optionId |
| TC-PERM-03 | send blocked while waiting for permission | P0 | M | Manual | waiting_permission | canSend false |
| TC-PERM-04 | allow_once continues stream | P0 | M/L1 | Manual/e2e | allow once | status leaves waiting; tool completes |
| TC-PERM-05 | deny leaves agent behavior observable | P1 | M | Manual | deny | not silent; may show error/stop explanation |
| TC-PERM-06 | deny_and_stop interrupts turn | P1 | M | Manual | deny and stop | near cancel; no further dangerous ops |
| TC-PERM-07 | always memory (workspace-level) | P2 | M | TBD(M3) | always allow | same tool does not reprompt (if implemented) |
| TC-PERM-08 | danger buttons visually distinct | P2 | M | Manual | deny-class | danger style (tokens) |

---

## 12. UI · Plan panel

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-PLAN-01 | plan arrival auto-opens right rail | P1 | M | Manual | agent pushes plan | showPlan true |
| TC-PLAN-02 | step status display | P1 | M | Manual | pending/in_progress/completed | list reflects post whole-replace status |
| TC-PLAN-03 | close then reopen | P2 | M | Manual | close → click “Plan” | content still there |
| TC-PLAN-04 | empty plan empty state | P2 | M | Manual | open empty plan | no crash |

---

## 13. UI · Composer (input / send / completion)

> Modules: `ComposerWidget`, `useComposerWidget`, `composerCompletion` · Existing `composerCompletion.test.ts`

### 13.1 Basic interaction

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-CMP-01 | Enter sends / Shift+Enter newline | P0 | M | Manual | multi-line input | matches README behavior |
| TC-CMP-02 | Send button and canSend | P0 | M | Manual | empty/streaming/permission | disabled; with text and idle can send |
| TC-CMP-03 | Stop / cancel | P0 | S/M | Covered | streaming | cancelTurn |
| TC-CMP-04 | limit input while connecting | P1 | M | Manual | connecting | canType false or equivalent |
| TC-CMP-05 | offline can view history but send fails | P0 | M | Manual | send offline | no false success; draft kept |
| TC-CMP-06 | mode cycle chip | P1 | M | Manual | click mode | Ask→Build→Plan cycle (implementation is cycle) |
| TC-CMP-07 | `@ file` entry visible | P0 | S | Covered | — | copy/button present |

### 13.2 @ file completion

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-CMP-10 | detect @ trigger at caret | P0 | U | Covered | findComposerTrigger | recognizes file mention |
| TC-CMP-11 | email text does not false-trigger | P0 | U | Covered | `a@b.com` | does not open file completion |
| TC-CMP-12 | query with whitespace closes | P1 | U | Covered | `@foo bar` | no active mention match |
| TC-CMP-13 | insert relative path mention | P0 | U | Covered | pick file suggestion | replace token; path real relative |
| TC-CMP-14 | empty result copy | P2 | U | Covered | getComposerEmptyLabel | reasonable empty label |
| TC-CMP-15 | menu keyboard ↑↓ Enter/Tab Esc | P1 | M | Manual | open menu | navigate/confirm/close |
| TC-CMP-16 | request failure does not crash | P1 | M | Manual | `@` while bridge down | safe empty / hint |

### 13.3 / slash commands and skills

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-CMP-20 | replace slash token keeps following text | P0 | U | Covered | replaceComposerTrigger | surrounding text correct |
| TC-CMP-21 | skill metadata scope label | P1 | U | Covered | _meta.scope | labeled as skill |
| TC-CMP-22 | available_commands filter match | P1 | U | Partial | type `/rev` | filters review etc. |
| TC-CMP-23 | empty when no commands | P2 | U | Partial | empty commands | empty label |

---

## 14. Live acceptance · M0 / demo e2e

### 14.1 M0 handshake (`npm run m0:live`)

| ID | Title | Priority | Layer | Status | Pre | Steps | Expected |
|---|---|---|---|---|---|---|---|
| TC-L0-01 | live-only default | P0 | L0 | Covered | ENV-CLI | `npm run m0` / m0:live | real CLI; no silent mock |
| TC-L0-02 | `--mock` experimental only with warning | P1 | L0 | Partial | — | m0:mock | prints warning; not product path |
| TC-L0-03 | full handshake + one prompt | P0 | L0 | Covered | ENV-CLI | introduce repo | streaming text and stopReason |
| TC-L0-04 | failure readable without grok | P0 | L0 | TBD | remove from PATH | run m0 | clear install/login guidance; no false green |

### 14.2 demo e2e (`npm run demo:e2e`)

| ID | Title | Priority | Layer | Status | Pre | Steps | Expected |
|---|---|---|---|---|---|---|---|
| TC-L1-01 | cwd locked to demo/ | P0 | L1 | Covered | ENV-CLI | run e2e | log shows demo cwd |
| TC-L1-02 | list dir / read hello.ts math.ts | P0 | L1 | Covered | — | task-board prompt | tool read; agent cites content |
| TC-L1-03 | small code edit | P0 | L1 | Covered | — | edit average etc. | changes only under demo |
| TC-L1-04 | no pollution of packages/ etc. | P0 | L1 | Partial | — | before/after file snapshot | non-demo repo has no new dirty files |
| TC-L1-05 | tool cards complete | P0 | L1 | Covered | alwaysApprove | — | tool status completed |
| TC-L1-06 | optional subagent | P2 | L1 | Partial | model supports | request subagent | record if present; skip without hard assert if not |
| TC-L1-07 | summary turn | P1 | L1 | Covered | — | summarize | has agent text |
| TC-L1-08 | log written to disk | P1 | L1 | Covered | — | — | `demo/e2e-last-run.log` |

---

## 15. End-to-end scenarios (browser · main user stories)

> Layer **M** · Pre **ENV-CLI + ENV-BRIDGE + ENV-UI**

### Scenario A · First launch and connect

| ID | Title | Priority | Status | Steps | Expected |
|---|---|---|---|---|---|
| TC-E2E-A1 | UI only, no bridge | P0 | Manual | only `npm run dev` | offline banner; no mock session; connect failure understandable |
| TC-E2E-A2 | bridge then UI | P0 | Manual | standard README two terminals | auto-connect / recoverable; chip “synced” |
| TC-E2E-A3 | refresh keeps catalog | P0 | Manual | chat one turn → refresh | sidebar still has session; click can resume |

### Scenario B · Full Q&A + tools

| ID | Title | Priority | Status | Steps | Expected |
|---|---|---|---|---|---|
| TC-E2E-B1 | simple Q&A | P0 | Manual | “Introduce demo in one sentence” | user + agent (+ maybe thought); can send again after idle |
| TC-E2E-B2 | read-file task | P0 | Manual | ask agent to read `src/hello.ts` | tool read card; answer includes content |
| TC-E2E-B3 | write file + permission | P0 | Manual | disable alwaysApprove; ask to edit file | permission modal; completes after allow; change under demo |
| TC-E2E-B4 | Stop mid-turn | P1 | Manual | long task click Stop | generation stops; can send again; late update does not crash |
| TC-E2E-B5 | multi-turn context | P1 | Manual | 3 turns referring to earlier context | agent understands context (live capability) |

### Scenario C · Multi-session

| ID | Title | Priority | Status | Steps | Expected |
|---|---|---|---|---|---|
| TC-E2E-C1 | new chat isolation | P0 | Manual | finish session A → new chat | empty timeline; new id |
| TC-E2E-C2 | switch without losing history | P0 | Manual | A↔B | each timeline/catalog correct |
| TC-E2E-C3 | rapid session clicks | P1 | Manual | click 3 in a row | final view is last selected; no scrambled overwrite |

### Scenario D · Disconnect recovery

| ID | Title | Priority | Status | Steps | Expected |
|---|---|---|---|---|---|
| TC-E2E-D1 | bridge crash | P0 | Manual | kill bridge | disconnected banner; history remains |
| TC-E2E-D2 | restart bridge and reconnect | P0 | Manual | restart bridge → connect/click session | session/load restores, not new ghost |
| TC-E2E-D3 | disconnect while generating | P1 | Manual | kill during streaming | status honest; reconnect can continue or clearly cannot |

### Scenario E · Completion and mode

| ID | Title | Priority | Status | Steps | Expected |
|---|---|---|---|---|---|
| TC-E2E-E1 | @ mention file then send | P1 | Manual | `@src/hello.ts` ask question | path enters prompt; agent can locate file |
| TC-E2E-E2 | / command selection | P1 | Manual | when available_commands present | inserts command name |
| TC-E2E-E3 | Ask/Plan/Build display | P1 | Manual | switch chip | top bar/composer consistent (if process-level sandbox switch not done, UI-only and docs must be honest) |

### Scenario F · Plan panel

| ID | Title | Priority | Status | Steps | Expected |
|---|---|---|---|---|---|
| TC-E2E-F1 | task that triggers plan | P1 | Manual | multi-step task | right-rail plan appears and updates |

---

## 16. Non-functional / constraints / regression

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-NF-01 | `npm run test:all` all green | P0 | R | Covered | CI/local | acp-core + desktop tests pass |
| TC-NF-02 | `npm run typecheck` | P0 | R | Covered | — | no type errors |
| TC-NF-03 | file line-count constraints | P1 | R | Manual | changed files | >440 must split; 200+ consider split |
| TC-NF-04 | no eslint-disable | P1 | R | TBD | grep | zero disable comments |
| TC-NF-05 | product path has no mock | P0 | S/R | Covered | ui-surfaces + review | see HC-* |
| TC-NF-06 | token stream performance (subjective) | P2 | M | Manual | long answer | no obvious frame drops (later rAF batching) |
| TC-NF-07 | memory: multi-session (M2) | P3 | L | TBD | multi runtime | LRU cap (mark N/A if unimplemented) |
| TC-NF-08 | locale passthrough (M3) | P3 | L | TBD | UI EN/ZH | agent language follows (todo pitfall) |

---

## 17. Security and privacy

| ID | Title | Priority | Layer | Status | Steps | Expected |
|---|---|---|---|---|---|---|
| TC-SEC-01 | API Key not in localStorage / URL | P0 | R | Manual/audit | search key storage | depends on grok login / env vars |
| TC-SEC-02 | workspace path escape | P0 | B | Partial | see TC-BR-30/31 | reject |
| TC-SEC-03 | log redaction | P2 | R | TBD | stderr/e2e log | no full key |
| TC-SEC-04 | permission default-deny safety | P1 | M | Manual | do not click allow | agent does not write disk |

---

## 18. Case ↔ existing automation map

| Automation asset | Covered cases (representative) |
|---|---|
| `packages/acp-core/test/codec.test.ts` | TC-CODEC-* |
| `packages/acp-core/test/timeline.test.ts` | TC-TL-01/02/10–13/20–23/25, TC-LC-*, partial title-related |
| `packages/acp-core/test/client.test.ts` | TC-CLI-01–05 |
| `apps/desktop/src/store/sessionCatalog.test.ts` | TC-CAT-01–06, TITLE |
| `apps/desktop/src/store/sessionStore.test.ts` | TC-ST-01 |
| `apps/desktop/src/widgets/composer/composerCompletion.test.ts` | TC-CMP-10–14/20–21 |
| `apps/desktop/src/ui-surfaces.test.ts` | TC-UI-01/08/09, TC-RAIL-01, TC-TM-01, TC-PERM-01/02, TC-CMP-03/07, HC-* |
| `npm run m0:live` | TC-L0-* |
| `npm run demo:e2e` | TC-L1-*, partial TC-CLI-10, TC-BR-01/08 |

---

## 19. Suggested fill-in priority (gaps)

### P0 TBD (automate soon)

1. **TC-ST-06** selectSession race (unit test with fake clock / sequence number)  
2. **TC-CLI-07** session/load replay (mock or live)  
3. **TC-BR-20/30/31** workspaceEntries + path sandbox unit tests  
4. **TC-L0-04** failure messaging without CLI  
5. **TC-UI-10** TSX color-rule static scan  

### P1 TBD

1. **TC-TL-03/04/15** tool dedup, unknown update  
2. **TC-TL-24** mode normalization  
3. **TC-CLI-06** late update after cancel  
4. **TC-CMP-15/22** completion keyboard and command-filter extensions  
5. Browser e2e (Playwright) skeleton: A2, B1, B3, C1, D2  

### P2 / future

1. Full diff review, terminal panel, model switch, RuntimePool LRU (M2/M3)  
2. always-allow persistence, locale, multi-workspace switch UI  
3. §23 community-inspired: message queue, session orchestration, sub-session visibility, permission cache invalidation (see TC-UX-*)

---

## 20. Release / merge checklist (R)

Run in order:

```bash
# 1) Types and unit tests (mock allowed only in acp-core)
npm run typecheck
npm run test:all

# 2) Product hard-constraint spot check (or rely on ui-surfaces)
# - App/sessionStore has no mock entry
# - defineColor / layout has no hex

# 3) Live (needs ENV-CLI)
M0_CWD="$(pwd)/demo" npm run m0:live
npm run demo:e2e
# Inspect demo/e2e-last-run.log; confirm packages/ not polluted

# 4) UI main path (manual)
# Terminal A: npm run bridge
# Terminal B: npm run dev
# Scenarios: A2 → B1 → B2 → C1 → D1/D2 → E1
# Community high-frequency pain spot-check (§23): G1 queue/steer · G2 permission storm · G3 active session visible · G4 interrupt recovery
```

**Pass criteria**:

- [ ] `test:all` / `typecheck` green  
- [ ] HC-01–HC-05 all satisfied  
- [ ] m0:live and demo:e2e succeed with local CLI  
- [ ] UI has no mock; disconnect is honest; new chat / resume has no ghost sessions  
- [ ] demo write ops do not pollute other repo directories  
- [ ] If this iteration claims queue/multi-session/permission memory: corresponding TC-UX-* and Scenario G at least spot-checked  

---

## 21. Appendix · State machine quick reference

```
idle ──sendPrompt──▶ streaming
streaming ──request_permission──▶ waiting_permission
waiting_permission ──respond──▶ streaming
streaming ──prompt settled + quiet N ms──▶ idle
* ──transport lost──▶ disconnected
disconnected ──reconnect / selectSession──▶ connecting → live-bridge (+ load)
```

**Streaming end rule**: `session/prompt` response has returned **and** update queue has been quiet for about `settleQuietMs` (bridge default 300ms). After cancel, late tool updates may still arrive.

---

## 22. Appendix · Bridge message contract (acceptance reference)

| Client → Bridge | Meaning |
|---|---|
| `start` | Connect session: `resumeId` / `forceNew` / `seed` / `cwd` / `alwaysApprove` |
| `prompt` | `{ text }` |
| `cancel` | Cancel current turn |
| `permission` | `{ optionId }` |
| `list_workspace_entries` | `{ requestId, query }` |
| `ping` | Heartbeat |

| Bridge → Client | Meaning |
|---|---|
| `hello` | cwd + port |
| `state` | Full `SessionState` |
| `stderr` / `error` / `info` | Diagnostics |
| `workspace_entries` | Completion entries |
| `pong` | Heartbeat response |

---

## 23. Community-inspired functional tests (Codex / agent clients · from X)

> **Why a separate chapter**: OpenAI Codex desktop/CLI users share heavily on X about “how they use it” and “where it hurts.”  
> That feedback maps directly to **supervisory agent client** functional acceptance, aligned with grok-desktop’s positioning (session rail, permissions, plan, multi-session, tool stream). It belongs in functional tests—not protocol codec tests alone.  
> **Labels**: `MVP` = accept against current/near-term implemented surface; `Target` = acceptance after product parity with Codex-class clients (may mark N/A first).  
> **Sources**: public X discussion (session orchestration, queue/steer, permission storms, sidebar losing active sessions, long-thread performance, plan-first workflows, etc.)—not official specs.

### 23.0 Experience themes → product capability map

| Community theme (high frequency on X) | Real user need | grok-desktop landing | Case prefix |
|---|---|---|---|
| Session orchestration | Create/rename/archive sessions; agent owns session lifecycle | Session rail + catalog + session/new·load | TC-UX-SES |
| Parallel sessions / subagents | Main session orchestrates, sub-sessions work, both conversations visible | multi-session catalog; timeline shows tool/subagent | TC-UX-PAR |
| Queue vs Steer | Can “queue” next message while generating—not only interrupt or silently drop | Composer send policy | TC-UX-QUE |
| Permission / approval hell | Modal storms, permission changes not applied, wrong mode defaults, invisible hang | Permission modal + mode + status | TC-UX-PERM |
| Find active / unread | Cannot find running session in sidebar; unread/in-progress not obvious | Session rail pip / sort / filter | TC-UX-RAIL |
| Interrupt → resume clean | After one interrupt, continuing work must be clean | cancel + idle + send again | TC-UX-INT |
| Plan-first / AGENTS.md | Plan then build; project rules visible | Plan panel + mode + rules badge | TC-UX-PLAN |
| Review local / PR mental model | After edits need /review and see diff—not blind trust | Tool card diff + summary turn | TC-UX-REV |
| Long thread / RAM | Long sessions slow, UI janks, idle sessions eat memory | timeline performance; process reclaim (M2) | TC-UX-PERF |
| Worktree / isolation parallel | Parallel tasks do not collide working copies | demo isolation + future worktree (M2+) | TC-UX-ISO |
| End-of-turn readable summary | End needs a human summary, not a thesis | last agent message / optional summary UI | TC-UX-SUM |
| CLI ↔ App same session surface | Sessions started in CLI appear in App list | catalog / session list from agent | TC-UX-SYNC |
| Permission vs automation consistency | Scheduled/background tasks lose write permission | mode/sandbox and alwaysApprove honesty | TC-UX-AUT |

---

### 23.1 Session orchestration and discoverability

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-SES-01 | Sidebar always locates “running” session | P0 | M | TBD | MVP | Session A streaming; switch to B then back to list | A has running/streaming mark and sorts high or is filterable; does not “disappear” | Users report new sidebar cannot find active session |
| TC-UX-SES-02 | List status updates when background session streams | P0 | M | TBD | MVP | A generating while browsing B | A pip/status updates live; switch back to A shows latest timeline | Multi-session supervision (Codex mission control) |
| TC-UX-SES-03 | Rename/title update reflects immediately | P1 | M | Partial | MVP | agent `session_info_update` or user message yields title | Sidebar title refreshes; not weak Chat id | Orchestration includes rename |
| TC-UX-SES-04 | Delete/archive does not ghost-restore | P1 | M | TBD | Target | delete session → refresh/reconnect | catalog has no entry; no mistaken load of old id | delete/archive lifecycle |
| TC-UX-SES-05 | New chat does not clobber other session run state | P0 | M | Manual | MVP | click “New chat” while B streaming | B still visible in list; new session independent (if single-process limit, explicit prompt—**forbid** silently killing B with no feedback) | Parallel workflows |
| TC-UX-SES-06 | Search/locate historical sessions | P2 | M | TBD | Target | find by title keyword | can locate (Spotlight-class pain: cannot find chat) | Session recovery tooling need |
| TC-UX-SES-07 | Cold start loads list metadata only | P1 | M | Partial | MVP | open App with many catalog sessions | list first, load on demand; not stuck 2–3 minutes before clickable | Remote open slow, full-load complaints |

---

### 23.2 Parallel sessions / subagent visibility

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-PAR-01 | UI observable when main session requests subagent | P1 | L1/M | Partial | MVP | live task triggers subagent (if model supports) | timeline/tool records it; skip without hard hang if unsupported | Orchestration + sub-sessions is a Codex selling point |
| TC-UX-PAR-02 | User can append instruction semantics to a running session | P1 | M | TBD | Target | send to streaming session (steer or queue) | Behavior documented: interrupt / queue / reject; **forbid silent message drop** | main try to steer subagent ignored |
| TC-UX-PAR-03 | After sub-session ends, main-session summary is reachable | P2 | M | TBD | Target | multi-agent collab one turn | main session shows summary or handoff cue | orchestrator mode |
| TC-UX-PAR-04 | Sub-session relation not mysteriously lost after refresh | P1 | M | TBD | Target | has sub-session → refresh | either recoverable reference or clear “ended”; forbid UI showing still-running while agent says gone | subagent vanishes after reload |
| TC-UX-PAR-05 | Parallel small task + one deep task do not overwrite each other | P1 | M | Manual | MVP | session A small file fix, B long plan | catalog dual sessions; timelines independent | early web parallel papercut + CLI deep work |

---

### 23.3 Message queue vs steer (Queue / Steer) — high-frequency differentiator

> Community consensus: **steer** = immediately insert/interrupt current turn; **queue** = wait until current turn fully ends, then run next.  
> “Interrupt only” or “Send while generating silently drops” both get flamed. Codex CLI `/queue` is repeatedly praised.

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-QUE-01 | streaming send behavior has explicit product definition | P0 | M | TBD | MVP | Enter/Send while generating | **one of three, UI-perceptible**: (a) disable + hint; (b) enqueue; (c) steer/interrupt. Forbid silent failure | queue vs steer is core workflow |
| TC-UX-QUE-02 | Queue: auto-send next after current turn ends | P1 | M | TBD | Target | queue one item while streaming | after turn idle, auto prompt; queue length visible | Codex queue widely relied on |
| TC-UX-QUE-03 | Queue item can be cancelled singly | P2 | M | TBD | Target | remove after enqueue | not sent; does not pollute timeline | change of mind |
| TC-UX-QUE-04 | Steer and Queue shortcuts not confused | P1 | M | TBD | Target | document Enter / modifiers | matches common clients or has hint; accidental trigger undoable/hinted | Claude App vs Codex opposite shortcuts criticized |
| TC-UX-QUE-05 | draft not lost while generating | P0 | M | Partial | MVP | keep typing during streaming | draft kept (clear only on successful send); switch-session return policy clear | jot next instruction while watching |
| TC-UX-QUE-06 | queue full/too-long protection | P3 | U | TBD | Target | queue many items in a row | cap or warning; prevent token maxxing | vendor limit discussions |

---

### 23.4 Permissions and approvals (community #1 pain zone)

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-PERM-01 | permission modal cannot be scrolled away and ignored | P0 | M | Manual | MVP | trigger permission | modal + banner; composer send disabled | approvals live in session; easy to miss |
| TC-UX-PERM-02 | forbid unthrottled “approval storm” | P0 | M/L1 | TBD | MVP | many tools need permission in a row | serial confirm OK; UI does not lock up; merge-same-kind or always option works | approvals every 10–30s |
| TC-UX-PERM-03 | allow_always then same tool no longer prompts | P1 | M | TBD | Target | always allow → trigger same tool again | no more `waiting_permission` (workspace-level memory) | still denied after change |
| TC-UX-PERM-04 | permission policy change immediately invalidates old cache | P0 | M | TBD | MVP/Target | deny → allow or change mode then same op | **new policy applies**; does not keep returning old deny | Allow browsing still denied; needs cache invalidation |
| TC-UX-PERM-05 | new session permission defaults stable | P0 | M | TBD | MVP | open 3 new chats in a row | mode/approval defaults consistent; no “shows Full Access actually Ask” | new chat Full Access becomes Ask |
| TC-UX-PERM-06 | waiting_permission discoverable globally | P0 | M | TBD | MVP | permission on session A, user on B | sidebar/global hint “A waiting permission”; click enters to approve | approval tied to one session freezes whole workflow |
| TC-UX-PERM-07 | after deny, agent does not fake-continue writing disk | P0 | L1/M | Manual | MVP | deny write file | demo file unchanged; status honest | safety floor |
| TC-UX-PERM-08 | autoApprove without UI separated from product path | P0 | L1/S | Partial | MVP | e2e alwaysApprove vs UI | UI default not silent full-open; e2e may enable | prevent product looking fully auto-approved |
| TC-UX-PERM-09 | mode (Ask/Plan/Build) matches real sandbox | P0 | M | TBD | Target | UI shows Plan, attempt write | either process-level read-only, or explicit “UI label only, sandbox not switched”—**forbid lying** | todo hard constraint on permission modes |
| TC-UX-PERM-10 | background/scheduled task permission not quietly degraded | P2 | M | TBD | Target | if automation exists | write permission matches foreground or explicit read-only note | scheduled tasks become read-only and cannot write |

---

### 23.5 Interrupt, recovery, and “pick up again”

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-INT-01 | after Stop, state returns to sendable | P0 | M | Manual | MVP | streaming → Stop | reaches idle/sendable quickly; not permanent spinner | is interrupt clean |
| TC-UX-INT-02 | after Stop, timeline fully reviewable | P1 | M | Manual | MVP | interrupt long answer | generated content kept; tool cards reach reasonable final state | debug/continue writing |
| TC-UX-INT-03 | send after Stop does not cross turns | P0 | M | Manual | MVP | cancel → immediate new prompt | new user block; old-turn late updates do not pollute new-turn semantics | dirty state |
| TC-UX-INT-04 | after reconnect, in-progress is not fake streaming | P0 | M | Manual | MVP | kill bridge while streaming → reconnect | no permanent “Generating…”; can resume or clearly interrupted | wrong state after remote/desktop switch |

---

### 23.6 Plan-first and project rules workflow

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-PLAN-01 | Plan mode explores before code changes | P1 | M | Manual | MVP | mode=plan, ask to edit files | mostly read-only/plan; if still writes, fail or permission block matches mode promise | plan mode + context interview workflow |
| TC-UX-PLAN-02 | plan panel steps advance with execution | P1 | M | Manual | MVP | multi-step task | entry statuses update (UI refresh after whole-replace) | long-task todos/gates |
| TC-UX-PLAN-03 | AGENTS.md / project rules visible | P1 | M | TBD | Target | demo includes AGENTS.md | top bar/sidebar badge clickable to view rules | users unaware rules override settings |
| TC-UX-PLAN-04 | long-task objective survives multi-turn | P2 | M | TBD | Target | multi-turn same objective | plan/title/first user goal still traceable | cross-session objective/handoff |

---

### 23.7 Review / Diff / end summary

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-REV-01 | edit tools must expose discoverable diff | P0 | M | Partial | MVP | agent edits demo file | tool card shows path/changes; user can verify | in-thread review |
| TC-UX-REV-02 | turn end has readable human summary | P1 | M | Manual | MVP | finish small task | last agent message says what was done/next; not pure log dump | “plain easy summaries” preference |
| TC-UX-REV-03 | user can request “review only, no edits” | P1 | L1/M | Manual | MVP | after edits / ask for review | read-only analysis; no extra disk write (or explicit consent) | /review workflow |
| TC-UX-REV-04 | background auto-review must not silently burn quota | P2 | M | TBD | Target | if product has auto-review | default off or explicit switch; usage attributable | auto-review swallowed millions of tokens |
| TC-UX-REV-05 | multi-file change list scannable | P1 | M | TBD | Target | one turn edits many files | context rail or list summarizes path +12−3 | Codex right-side diffs |

---

### 23.8 Performance, long sessions, resources

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-PERF-01 | long timeline still allows input/send | P1 | M | Manual | MVP | send prompt after 50+ messages | send not “stuck 30s+”; UI clickable | long threads freeze, text disappears |
| TC-UX-PERF-02 | streaming output no lost chars / blank flash | P0 | M | Manual | MVP | long answer | text grows monotonically; refresh does not lose catalog cache | text disappears |
| TC-UX-PERF-03 | idle sessions soft-reclaimed (do not kill running) | P2 | L | TBD | Target | open many sessions then leave idle long | memory controllable; running not killed | RAM doubles; need soft idle |
| TC-UX-PERF-04 | shell operable while multi-session running | P1 | M | Manual | MVP/Target | two sessions streaming | sidebar switch and scroll still work | UI jittery while sessions run |
| TC-UX-PERF-05 | thought/verbose collapsible to save cognition | P2 | M | Manual | MVP | lots of thought | default collapsed; agent body unaffected | reduce narration noise |

---

### 23.9 Workspace isolation and parallel safety

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-ISO-01 | default demo cwd write isolation | P0 | L1 | Covered | MVP | demo:e2e | does not pollute packages/ | parallel does not hit main workspace |
| TC-UX-ISO-02 | two sessions same cwd conflict understandable | P1 | M | Manual | MVP | A and B edit same file | no silent mutual overwrite without hint; final disk state explainable | worktree isolation is advanced fix |
| TC-UX-ISO-03 | worktree parallel (M2+) | P3 | M | TBD | Target | if git worktree supported | each session independent tree; merge path clear | multi-agent zero-conflict narrative |

---

### 23.10 CLI / App session surface unification

| ID | Title | Priority | Layer | Status | Stage | Steps | Expected | Community motivation |
|---|---|---|---|---|---|---|---|---|
| TC-UX-SYNC-01 | bridge-restored id loadable as CLI session | P1 | L0/M | TBD | Target | load known sessionId | UI and stdio share same session history | CLI sessions appear in App |
| TC-UX-SYNC-02 | App catalog aligns with real agent ids | P0 | M | Manual | MVP | new chat → refresh → open | no fake id; weak titles pruned | ghost Chat 019… |

---

### 23.11 End-to-end Scenario G · community workflow regression

> Pre: ENV-CLI + ENV-BRIDGE + ENV-UI. Minimal “use it like a Codex user for a day” set.

| ID | Title | Priority | Status | Steps | Expected |
|---|---|---|---|---|---|
| TC-E2E-G1 | deep work + queue next | P1 | Manual/product-pending | session A long task; while generating write “next cut” intent (queue or explicit disable hint) | instruction not lost; after end can run or user knows how |
| TC-E2E-G2 | permission storm stress | P0 | Manual | disable alwaysApprove; require consecutive read+write+execute | each decision completable; no infinite modal loop; always once then smooth |
| TC-E2E-G3 | dual-session supervision | P0 | Manual | A edits `hello.ts`, B asks architecture; switch back and forth | both status and timelines correct; list shows who is running |
| TC-E2E-G4 | interrupt then continue | P0 | Manual | long generation Stop → “continue from just now” | can send; context still present; no zombie streaming |
| TC-E2E-G5 | Plan → Build honest switch | P1 | Manual | Plan then switch Build to execute | mode display correct; if process restart needed, clear wait hint |
| TC-E2E-G6 | human review after code change | P0 | Manual | small edit → open tool diff / inspect file | user can verify inside UI before continuing |
| TC-E2E-G7 | find session | P1 | Manual | open ≥5 sessions then find one still streaming | click it within ≤3s; has status mark |
| TC-E2E-G8 | morning parallel papercut | P2 | Manual | open 3 small-fix sessions in a row (or serial sim) | each completable/viewable independently; no catalog crosstalk |

---

### 23.12 Cross-index with existing cases

| Community cases | Related existing IDs |
|---|---|
| TC-UX-SES-* | TC-RAIL-*, TC-CAT-*, TC-E2E-C* |
| TC-UX-QUE-* | TC-CMP-01–05, TC-ST-03–05 |
| TC-UX-PERM-* | TC-PERM-*, TC-LC-03/05, TC-SEC-* |
| TC-UX-INT-* | TC-E2E-B4, TC-CLI-06, TC-E2E-D* |
| TC-UX-PLAN-* | TC-PLAN-*, TC-E2E-F1, TC-ST-13 |
| TC-UX-REV-* | TC-TOOL-*, TC-L1-03, TC-E2E-B2 |
| TC-UX-PERF-* | TC-TM-02/08, TC-NF-06/07 |
| TC-UX-ISO-* | TC-L1-04, TC-BR-30/31 |
| TC-E2E-G* | “workflow superset” of Scenarios A–F |

---

### 23.13 Implementation gap suggestions (ordered by community pain)

When shipping product, priority order (test-driven issues may follow this too):

| # | Capability | Related cases | Value |
|---|---|---|---|
| 1 | **streaming send policy** (disable+hint / queue / steer — pick one and do it thoroughly) | TC-UX-QUE-01/02/05 | highest daily frequency |
| 2 | **waiting permission discoverable across sessions** + storm prevention | TC-UX-PERM-02/06 | prevent “stuck and don’t know why” |
| 3 | **active session first-class in sidebar** | TC-UX-SES-01/02, G3/G7 | multi-session supervision |
| 4 | **permission changes take effect immediately** | TC-UX-PERM-04/05 | trust |
| 5 | **Stop recovers cleanly** | TC-UX-INT-* | sense of control |
| 6 | **Plan/rules visible + mode honest** | TC-UX-PLAN-*, PERM-09 | power users |
| 7 | queue, sub-session relations, worktree, auto-review switch | remaining Target items | full Codex-class surface |

---

*This document updates with feature iteration: when adding a surface, add matching case IDs and map automation assets in §18. §23 may grow with new X/community pain points, but must map to executable steps and expected results—avoid vague parity claims.*
