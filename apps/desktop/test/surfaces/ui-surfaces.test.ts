/**
 * Structural checks: shell chrome IA + live-only product path + UnoCSS setup.
 * Assertions match the slim top-nav / Composer mode / footer drawer IA.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createGenerator } from "unocss";
import unoConfigModule from "../../uno.config";
import { appShortcuts } from "../../uno/shortcuts";
import {
  readAllUnoShortcuts,
  readBaseStyles,
  readDesktopRoot,
  readSrc,
  SRC_ROOT,
  srcExists,
} from "../helpers/sourceFiles";

describe("UI surface presence", () => {
  it("timeline renders user/agent/thought/tool kinds", () => {
    const timeline = readSrc("widgets/timeline/TimelineView.tsx");
    const widget = readSrc("widgets/timeline/TimelineWidget.tsx");
    const hook = readSrc("widgets/timeline/useTimelineWidget.ts");
    const thought = readSrc("widgets/timeline/ThoughtWidget.tsx");
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    // Stateful entry is TimelineWidget + useTimelineWidget; View is pure.
    assert.match(widget, /useTimelineWidget|TimelineView/);
    assert.match(hook, /useSessionStore|buildTimelineRenderUnits/);
    assert.doesNotMatch(timeline, /useSessionStore/);
    assert.match(thought, /data-kind="thought"|dataKind="thought"/);
    assert.match(tool, /data-kind="tool"/);
    assert.match(timeline, /toolCalls/);
    // User bubble: text + image thumbs via UserMessageView; never paint
    // ContentBlock.type names (resource embeds used to leak "resource").
    assert.match(timeline, /UserMessageView/);
    // Residual work units share TurnStepView (no parallel agent/thought/tool tree).
    assert.match(timeline, /TurnStepView/);
    assert.doesNotMatch(timeline, /ThoughtGroupView|ToolGroupView|ThoughtWidget|ToolCardView/);
    const userMsg = readSrc("widgets/timeline/UserMessageView.tsx");
    assert.match(userMsg, /userTextFromBlocks|userImagesFromBlocks/);
    assert.match(userMsg, /data-kind="user"/);
    assert.match(userMsg, /msg-user-attachment-thumb/);
    // Reserved 80×80 tile + explicit img box so decode cannot reflow the page.
    assert.match(userMsg, /USER_THUMB_PX/);
    assert.match(userMsg, /width=\{USER_THUMB_PX\}/);
    assert.match(userMsg, /height=\{USER_THUMB_PX\}/);
    assert.match(userMsg, /user-img-\$\{index\}/);
    const timelineShortcuts = readDesktopRoot("uno/shortcuts.timeline.ts");
    assert.match(
      timelineShortcuts,
      /"msg-user-attachment":\s*"[^"]*min-w-20[^"]*max-w-20/,
    );
    assert.match(
      timelineShortcuts,
      /"msg-user-attachment-thumb":\s*"[^"]*absolute inset-0/,
    );
    // Click-to-preview uses the shared ImageLightboxView (composer + history).
    assert.match(userMsg, /ImageLightboxView|handleOpenImage|lightboxIndex/);
    const lightbox = readSrc("widgets/shared/stateless/ImageLightboxView.tsx");
    assert.match(lightbox, /image-lightbox/);
    // Full-page dialog: portal out of overflow ancestors + backdrop dismiss.
    assert.match(lightbox, /createPortal/);
    assert.match(lightbox, /aria-modal/);
    assert.doesNotMatch(
      userMsg,
      /b\.type === ["']text["'] \? b\.text : b\.type/,
    );
  });

  it("App surfaces auth environment banner hooks", () => {
    const app = readSrc("App.tsx");
    const banners = readSrc("widgets/shell/ShellBannersView.tsx");
    assert.match(app, /ShellBannersView|useAppShellWidget/);
    assert.match(banners, /authOk|environment|authMessage/);
  });

  it("composer has send and cancel/stop and mode control", () => {
    const view = readSrc("widgets/composer/ComposerWidget.tsx");
    const hook = readSrc("widgets/composer/useComposerWidget.ts");
    const modeView = readSrc("widgets/composer/ComposerModeControlView.tsx");
    const input = readSrc("widgets/composer/ComposerInputView.tsx");
    const status = readSrc("widgets/composer/composerStatus.ts");
    assert.match(view, /composer-dock/);
    // Live-turn strip sits in the dock, not the timeline scroller (answer punch-through).
    assert.match(view, /TurnStatusWidget/);
    const timeline = readSrc("widgets/timeline/TimelineView.tsx");
    assert.doesNotMatch(timeline, /TurnStatusWidget/);
    // Default shortcut copy (incl. @ files) lives in the pure status resolver.
    assert.match(status, /@ files?/);
    // One status path: pure resolver + always-mounted row (no dual sendHint + footer).
    assert.match(view, /resolveComposerStatus|statusLine/);
    assert.match(view, /composer-status/);
    assert.match(view, /aria-live="polite"/);
    assert.match(view, /aria-atomic="true"/);
    assert.doesNotMatch(view, /sendHint/);
    assert.match(view, /ComposerModelMenuView/);
    assert.match(view, /ComposerModeControlView/);
    assert.match(view, /ComposerInputView/);
    // Mid-turn follow-ups sit ABOVE the composer card, never inside it.
    assert.match(view, /ComposerQueueView/);
    assert.match(view, /useComposerQueue/);
    const queueBeforeCard = view.search(/<ComposerQueueView[\s\S]*?<div className="composer">/);
    const queueInsideCard = view.search(
      /<div className="composer">[\s\S]*?<ComposerQueueView/,
    );
    assert.ok(queueBeforeCard >= 0, "queue panel must render before .composer");
    assert.equal(queueInsideCard, -1, "queue panel must not live inside .composer");
    const queueView = readSrc("widgets/composer/ComposerQueueView.tsx");
    assert.match(queueView, /Send now/);
    assert.match(queueView, /aria-label="Edit"/);
    assert.match(queueView, /aria-label="Cancel"/);
    assert.match(queueView, /composer-queue-index/);
    assert.match(queueView, /Queued follow-up \$\{position\}/);
    const shortcuts = readAllUnoShortcuts();
    const queueRow = shortcuts.match(/"composer-queue-row":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(queueRow, /\bbg-composer-queue\b/);
    assert.match(queueRow, /\bborder-line-queue\b/);
    assert.doesNotMatch(queueRow, /\bbg-elevated\b/);
    const queueActions =
      shortcuts.match(/"composer-queue-actions":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(queueActions, /opacity-0/);
    assert.match(queueActions, /group-hover:\(opacity-100/);
    const queueStore = readSrc("store/sessionStore.ts");
    assert.match(queueStore, /sendQueuedPromptNow|sendQueuedNowAction/);
    assert.match(queueStore, /removeQueuedPrompt/);
    const banners = readSrc("widgets/shell/ShellBannersView.tsx");
    assert.doesNotMatch(banners, /prompt\(s\) queued/);
    // Mic chip toggles listening chrome that mirrors into the input field.
    assert.match(view, /toggleDictation/);
    assert.match(view, /aria-pressed=\{widget\.dictating\}/);
    assert.match(view, /composer-chip-btn-active/);
    assert.match(view, /listening=\{widget\.dictating\}/);
    // Placeholder still says Listening… while draft empty; full sentence is status-only.
    assert.match(view, /Listening…/);
    assert.match(hook, /sendPrompt/);
    assert.match(hook, /cancelTurn/);
    assert.match(hook, /useComposerCompletion/);
    assert.match(hook, /selectModel|selectEffort/);
    assert.match(hook, /pendingMode|selectMode|cycleMode/);
    assert.match(hook, /toggleDictation|stopDictation/);
    assert.match(hook, /useComposerDictation/);
    assert.match(hook, /useComposerNotice|showNotice/);
    assert.doesNotMatch(hook, /sendHint|setSendHint/);
    const dictation = readSrc("widgets/composer/useComposerDictation.ts");
    assert.match(dictation, /joinDictationDraft/);
    assert.match(dictation, /toggleDictation/);
    // Dictation must not own Listening status text or prefix-sniff clears.
    assert.doesNotMatch(dictation, /startsWith\(["']Listening/);
    assert.doesNotMatch(
      dictation,
      /Listening… · click Mic to stop/,
    );
    // Listening sentence appears exactly once across widget + dictation + status module.
    const listeningSentence = "Listening… · click Mic to stop · Enter to send";
    const combined = `${view}\n${dictation}\n${status}`;
    const listeningHits = combined.split(listeningSentence).length - 1;
    assert.equal(
      listeningHits,
      1,
      "listening status sentence must exist in exactly one place (composerStatus)",
    );
    assert.match(status, /resolveComposerStatus/);
    assert.match(input, /listening/);
    // Field chrome via data-state (color only), not dual-ring listening class.
    assert.match(input, /data-state/);
    assert.match(input, /listening/);
    assert.doesNotMatch(input, /composer-input-listening|data-listening/);
    assert.match(modeView, /role="radiogroup"/);
    assert.match(modeView, /aria-checked/);
    assert.match(modeView, /aria-busy/);
    // Pending must not expand the chip with "Switching to …" (layout flash).
    assert.doesNotMatch(modeView, /Switching to \$\{modeLabel/);
    assert.match(modeView, /modeLabel\(displayMode\)/);
    // Mic chip must not swap its visible label to "Listening" (bar width flash).
    assert.doesNotMatch(view, /dictating\s*\?\s*["']Listening["']/);
    assert.match(view, /composer-mic-chip/);
    // Codex-style + attach control opens the image file picker.
    assert.match(view, /openFilePicker/);
    assert.match(view, /composer-attach-btn/);
    assert.match(view, /type="file"/);
    assert.match(view, /accept="image\/\*"/);
    assert.match(view, /composer-attach-input/);
    // File input stays outside .composer flex so open/focus cannot jitter height.
    assert.match(view, /composer-dock-inner[\s\S]*composer-attach-input[\s\S]*className="composer"/);
    assert.match(hook, /openFilePicker|handleFileInputChange|fileInputRef/);
  });

  it("permission UI offers selectable outcomes", () => {
    const src = readSrc("widgets/PermissionModalView.tsx");
    assert.match(src, /respondPermission/);
    assert.match(src, /allow_once/);
    assert.match(src, /deny/);
  });

  it("App shell matches prototype regions", () => {
    const src = readSrc("App.tsx");
    assert.match(src, /SessionRailWidget/);
    assert.match(src, /TimelineWidget/);
    assert.match(src, /ComposerWidget/);
    assert.match(src, /TopNavWidget/);
    assert.match(src, /main-column/);
    assert.match(src, /main-column-flush/);
    assert.match(src, /data-sidebar/);
    assert.match(src, /sidebarDocked/);
    assert.match(src, /onCollapse=\{shell\.collapseSidebar\}/);
    assert.match(src, /onToggleRail=\{shell\.toggleRail\}/);
    assert.match(src, /ContextDrawerWidget/);
    assert.match(src, /ShellBannersView/);
    assert.match(src, /useAppShellWidget/);
    assert.doesNotMatch(src, /Viewing saved history|read-only/);
    const top = readSrc("widgets/TopNavWidget.tsx");
    assert.match(top, /top-nav/);
  });

  it("surfaces command palette, environment sheet, settings, plan display-only, confirm", () => {
    const app = readSrc("App.tsx");
    assert.match(app, /CommandPaletteWidget/);
    assert.match(app, /EnvironmentSheetWidget/);
    assert.doesNotMatch(app, /ExtensionsPanelWidget/);
    assert.match(app, /SettingsPanelWidget/);
    assert.match(app, /ConfirmDialogView/);
    assert.match(app, /buildConfirmPrompt/);
    const shellHook = readSrc("widgets/shell/useAppShellWidget.ts");
    assert.match(shellHook, /activePanel|toggleExclusivePanel|PanelId/);
    assert.match(shellHook, /environmentPage/);
    const shell = readSrc("widgets/SidePanelShell.tsx");
    assert.match(shell, /side-panel-backdrop/);
    assert.match(shell, /side-panel-close/);
    assert.match(shell, /Escape/);
    // Modal focus: enter trap + restore; skip Escape under stacked alertdialog.
    assert.match(shell, /focusInitialIn|trapFocusTab|restoreFocus/);
    assert.match(shell, /alertdialog/);
    // Environment sheet is a modal catalog, not the 400px side drawer.
    const envSheet = readSrc("widgets/environment/EnvironmentSheetWidget.tsx");
    assert.match(envSheet, /env-sheet/);
    assert.match(envSheet, /Agent environment/);
    assert.match(envSheet, /role="dialog"/);
    assert.doesNotMatch(envSheet, /JSON\.stringify/);
    const confirm = readSrc("widgets/ConfirmDialogView.tsx");
    assert.match(confirm, /onCancel/);
    assert.match(confirm, /Escape/);
    assert.match(confirm, /stopImmediatePropagation/);
    assert.match(confirm, /onBackdropClick|onClick/);
    assert.match(confirm, /trapFocusTab/);
    assert.match(confirm, /confirm-head/);
    assert.match(confirm, /confirm-subject/);
    assert.match(confirm, /confirm-actions/);
    assert.match(confirm, /"btn-danger": isDanger/);
    const plan = readSrc("widgets/PlanPanelView.tsx");
    assert.doesNotMatch(plan, /Approve|plan-approval|sendPrompt|useSessionStore/);
    assert.doesNotMatch(plan, /showApproval|PlanApprovalDock/);
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    // Tool cards are flat surfaces: no pointer-following spotlight under them.
    assert.doesNotMatch(tool, /SpotlightCard/);
    assert.match(tool, /EditSummaryRowView/);
    assert.match(tool, /openPreview/);
    assert.doesNotMatch(tool, /DiffReview(View|Widget)/);
    const diff = readSrc("widgets/preview/DiffReviewWidget.tsx");
    assert.match(diff, /applyHunkDecisions/);
  });

  it("context drawer is always-mounted full-height with prefs and open prop", () => {
    const app = readSrc("App.tsx");
    assert.match(app, /ContextDrawerWidget/);
    assert.match(app, /PreviewDrawerWidget/);
    assert.match(app, /planRailOpen \|\| shell\.agentsRailOpen|open=\{shell\.planRailOpen/);
    assert.match(app, /open=\{shell\.previewRailOpen\}/);
    assert.match(app, /selectContextTab|onSelectTab/);
    assert.doesNotMatch(app, /contextRail === "plan" \? </);
    assert.match(app, /main-body-railed/);
    assert.match(app, /from "@\/widgets\/contextRail"/);
    assert.match(app, /from "@\/widgets\/preview"/);

    const drawer = readSrc("widgets/contextRail/ContextDrawerWidget.tsx");
    assert.match(drawer, /id="context-rail"/);
    assert.match(drawer, /context-drawer/);
    assert.match(drawer, /context-drawer-open|context-drawer-closed/);
    assert.match(drawer, /inert/);
    assert.match(drawer, /context-drawer-head/);
    assert.match(drawer, /Escape/);
    assert.match(drawer, /from "@\/components\/ui\/Checkbox"/);
    assert.match(drawer, /Checkbox/);
    assert.match(drawer, /data-drawer-width/);
    assert.match(drawer, /Resize session rail/);
    assert.doesNotMatch(drawer, /type="checkbox"/);
    assert.doesNotMatch(drawer, /showApproval|PlanApprovalDock|sendPrompt/);
    // Plan|Agents is one drawer: no per-tab width attribute or Agents-only handle.
    assert.doesNotMatch(drawer, /data-agents-width/);
    assert.doesNotMatch(drawer, /activeTab === "agents" \? chrome\.drawerWidth/);

    const drawerChrome = readSrc("widgets/contextRail/useContextDrawerChrome.ts");
    assert.match(drawerChrome, /drawerWidth = dragWidth \?\? storedWidth/);
    assert.doesNotMatch(drawerChrome, /PLAN_RAIL_WIDTH/);
    assert.doesNotMatch(
      drawerChrome,
      /activeTab === "agents" \? (?:agentsWidth|drawerWidth)/,
    );

    const top = readSrc("widgets/TopNavWidget.tsx");
    assert.match(top, /aria-expanded=\{props\.contextRailOpen\}/);
    assert.match(top, /aria-controls="context-rail"/);
    assert.match(top, /top-nav-railed/);
    assert.doesNotMatch(top, /aria-pressed=\{props\.contextRailOpen\}/);

    const shellHook = readSrc("widgets/shell/useAppShellWidget.ts");
    assert.match(shellHook, /loadContextDrawerPrefs|saveContextDrawerPrefs/);
    assert.match(shellHook, /resetForSession|resetAgentsForSession/);
    assert.match(shellHook, /resolveShellLayout/);
    assert.match(shellHook, /useSidebarVisibility/);
    assert.match(shellHook, /collapseSidebar|toggleRail/);
    assert.match(shellHook, /innerWidth|resize/);
    const sidebarHook = readSrc("widgets/shell/useSidebarVisibility.ts");
    assert.match(sidebarHook, /loadSidebarPrefs|saveSidebarPrefs/);
    assert.match(sidebarHook, /collapseSidebar/);
    assert.match(sidebarHook, /toggleRail/);
    // Open rail always pushes (empty Plan/Agents included); no content gate.
    assert.match(shellHook, /contextRailHasContent/);
    assert.doesNotMatch(shellHook, /agentItemCount/);
    // Reject the old per-active-tab content checks (caused Plan→Agents resize).
    assert.doesNotMatch(
      shellHook,
      /planRailOpen\s*&&\s*planCount\s*>\s*0/,
    );
    assert.doesNotMatch(
      shellHook,
      /agentsRailOpen\s*&&\s*subagentCount\s*>\s*0/,
    );

    const prefs = readSrc("lib/contextDrawerPrefs.ts");
    assert.match(prefs, /export function normalizeContextDrawerPrefs/);
    assert.match(prefs, /export function loadContextDrawerPrefs/);
    assert.match(prefs, /export function saveContextDrawerPrefs/);
    const shellLayout = readSrc("lib/shellLayout.ts");
    assert.match(shellLayout, /export function resolveShellLayout/);
    assert.match(shellLayout, /MAIN_COLUMN_MIN_WIDTH/);

    const chrome = readDesktopRoot("uno/shortcuts.chrome.ts");
    assert.match(chrome, /"context-drawer":/);
    assert.match(chrome, /"context-drawer-open":/);
    assert.match(chrome, /"context-drawer-closed":/);
    // Closed slide must use own-width 100% (preview is wider than plan rail token).
    assert.match(chrome, /context-drawer-closed[\s\S]*?translate-x-full/);
    assert.doesNotMatch(chrome, /plan-approval/);

    const shellShortcuts = readDesktopRoot("uno/shortcuts.shell.ts");
    assert.match(shellShortcuts, /"top-nav-railed":/);
    assert.match(shellShortcuts, /"main-body-railed":/);
    // Close-frame sync: transition must live on the base class so removing
    // *-railed still eases padding/right while the drawer translates out.
    assert.match(
      shellShortcuts,
      /"main-body":\s*[\s\S]*?transition-padding-right[\s\S]*?duration-slow/,
    );
    assert.match(
      shellShortcuts,
      /"top-nav":\s*[\s\S]*?transition-left-right[\s\S]*?duration-slow/,
    );
    assert.doesNotMatch(
      shellShortcuts,
      /"main-body-railed":\s*"[^"]*transition/,
    );

    const uno = readDesktopRoot("uno.config.ts");
    assert.match(uno, /translate-x-rail/);
    assert.match(uno, /"transition-padding-right"/);
    assert.match(uno, /"transition-left-right"/);
    assert.match(uno, /"transition-margin-left"/);
    assert.match(uno, /"min-h-topnav"/);
    assert.match(uno, /float:\s*"var\(--shadow-float\)"/);
    assert.match(uno, /translate-x-full/);
    assert.match(uno, /translate-x-none/);
    assert.match(uno, /"right-rail"/);
    assert.match(uno, /"pr-rail"/);

    const colors = readSrc("styles/defineColor.css");
    assert.match(colors, /--shadow-float:/);
    assert.match(colors, /--rail-right-width:\s*280px/);
    assert.match(colors, /--main-column-min-width:\s*560px/);
    assert.match(colors, /--sidebar-width:\s*272px/);
    assert.match(colors, /--preview-width-default:\s*560px/);
    assert.match(colors, /--preview-width-min:\s*420px/);
    assert.match(colors, /--preview-width-max:\s*900px/);
    assert.match(colors, /--agents-width-default:\s*300px/);
    assert.match(colors, /--agents-width-min:\s*200px/);
    assert.match(colors, /--agents-width-max:\s*432px/);

    const panels = readSrc("widgets/shell/shellPanels.ts");
    assert.match(panels, /ContextRailId\s*=\s*"plan"\s*\|\s*"preview"/);
    assert.match(panels, /contextRailWidthPx/);
    assert.match(panels, /export function contextRailHasContent/);
    // Open rail always reserves push space (empty companion included).
    assert.match(panels, /return rail !== null/);
    assert.doesNotMatch(panels, /planCount > 0 \|\| agentItemCount > 0/);
    // Plan and Agents share companionWidth — tab switch must not change push px.
    assert.match(panels, /rail === "plan" \|\| rail === "agents"/);

    const previewDrawer = readSrc("widgets/preview/PreviewDrawerWidget.tsx");
    assert.match(previewDrawer, /id="preview-rail"/);
    assert.match(previewDrawer, /preview-resize-handle|setWidth|clampPreviewWidth/);
    assert.match(previewDrawer, /usePreviewSource/);
    // Remount DiffReviewWidget when switching targets (avoids stale hunk state).
    assert.match(previewDrawer, /key=\{`\$\{source\.toolCallId\}:\$\{source\.path\}`\}/);
    // Single paint: drawer mounts only DiffReviewWidget (no sibling diff body).
    assert.match(previewDrawer, /DiffReviewWidget/);
    assert.doesNotMatch(previewDrawer, /PreviewDiffWidget/);
    assert.doesNotMatch(previewDrawer, /preview-diff-stack/);

    const previewSource = readSrc("widgets/preview/usePreviewSource.ts");
    assert.match(previewSource, /buildTurnChangeSetById/);
    // Click-to-refresh must keep the last file painted (no empty loading flash).
    assert.match(previewSource, /beginFilePreviewLoad/);
    assert.match(previewSource, /refreshing/);
    assert.match(previewDrawer, /PreviewFileStackView/);
    assert.match(previewDrawer, /preview-refresh-veil|PreviewFileStackView/);

    const shellPanelsSrc = readSrc("widgets/shell/shellPanels.ts");
    // Preview rail must not be auto-stolen by plan open.
    assert.match(shellPanelsSrc, /contextRail !== null/);
    // Session switch closes plan/agents companion by default.
    assert.match(shellPanelsSrc, /export function contextRailAfterSessionChange/);
    assert.match(shellHook, /contextRailAfterSessionChange/);
  });

  it("Uno shortcuts define side-panel and btn-ghost (no white-out drawers)", () => {
    const shortcuts = readAllUnoShortcuts();
    assert.match(shortcuts, /"side-panel":/);
    assert.match(shortcuts, /bg-elevated/);
    assert.match(shortcuts, /"btn-ghost":/);
    assert.match(shortcuts, /"side-panel-close":/);
    assert.match(shortcuts, /"modal-panel":/);
    assert.match(shortcuts, /"confirm-head":/);
    assert.match(shortcuts, /"confirm-subject":/);
    assert.match(shortcuts, /"confirm-actions":/);
  });

  it("top-nav shortcuts cover slim chrome only (no mode tabs)", () => {
    const shortcuts = readAllUnoShortcuts();
    const top = readSrc("widgets/TopNavWidget.tsx");
    const menuView = readSrc("widgets/SessionActionsMenuView.tsx");
    const shortcutNames = [
      "top-nav",
      "top-nav-left",
      "top-nav-session",
      "top-nav-session-title",
      "top-nav-session-id",
      "top-nav-sync",
      "top-nav-right",
      "top-nav-icon-btn",
      "top-nav-menu",
      "top-nav-context-btn",
    ];
    for (const name of shortcutNames) {
      assert.match(
        shortcuts,
        new RegExp(`"${name}":`),
        `missing shortcut definition: ${name}`,
      );
    }
    const usedInTop = [
      "top-nav",
      "top-nav-left",
      "top-nav-session",
      "top-nav-session-title",
      "top-nav-session-id",
      "top-nav-sync",
      "top-nav-right",
      "top-nav-icon-btn",
      "top-nav-context-btn",
    ];
    for (const name of usedInTop) {
      assert.match(top, new RegExp(name), `TopNav should use ${name}`);
    }
    assert.match(menuView, /top-nav-menu/);
    assert.match(menuView, /top-nav-menu-row/);
    assert.match(menuView, /top-nav-menu-kbd/);
    // Labels must not wrap ("Fork session" onto Rewind) — see shortcuts.
    assert.match(shortcuts, /"top-nav-menu-label":[\s\S]*?whitespace-nowrap/);
    assert.match(shortcuts, /"top-nav-menu-list":[\s\S]*?w-max/);
    // Shortcut chords (⌘N) must not sit in font-mono — ⌘ reads as #N.
    assert.match(shortcuts, /"top-nav-menu-kbd":[\s\S]*?font-sans/);
    assert.match(shortcuts, /"top-nav-menu-kbd":[\s\S]*?gap-1/);
    // Left slot must grow + clip so title does not collapse under right nav
    assert.match(shortcuts, /"top-nav-left":[\s\S]*?flex-1[\s\S]*?overflow-hidden/);
    // Removed IA: no top-nav mode chip or Chat|Plan tablist (permanent chrome)
    assert.doesNotMatch(top, /top-nav-mode|top-nav-links|role="tab"/);
    // Labels that used to live in top-nav chrome — allow doc comments only
    assert.doesNotMatch(
      top,
      />(?:Chat|Tasks|Overview|Extensions|Environment|Settings)</,
    );
    assert.doesNotMatch(top, /Plan ·/);
    // Composer owns mode chrome
    assert.match(shortcuts, /"composer-mode":/);
    assert.match(shortcuts, /"composer-mode-trigger":/);
    assert.match(shortcuts, /"composer-mode-menu":/);
  });

  it("settings sticky apply, dirty helpers, no ticket ids, tokenized controls", () => {
    const settings = readSrc("widgets/SettingsPanelWidget.tsx");
    const security = readSrc("widgets/settings/SettingsSecuritySectionView.tsx");
    const account = readSrc("widgets/settings/SettingsAccountSectionView.tsx");
    const shell = readSrc("widgets/SidePanelShell.tsx");
    const draft = readSrc("lib/settingsDraft.ts");
    const shortcuts = readAllUnoShortcuts();
    assert.match(shell, /footer/);
    assert.match(shell, /toolbar/);
    assert.match(shell, /stickySection/);
    assert.match(shortcuts, /"side-panel-footer":/);
    assert.match(shortcuts, /"side-panel-toolbar":/);
    assert.match(shortcuts, /"side-panel-sticky":/);
    // Account is pinned outside the scroll body, not a body child.
    assert.match(settings, /stickySection=/);
    assert.match(settings, /SettingsAccountSectionView/);
    assert.match(settings, /loggedIn=\{loggedIn\}/);
    assert.match(settings, /environment\?\.authed === true/);
    // Login and Logout are mutually exclusive (never both in the same tree).
    assert.match(account, /loggedIn \? \(/);
    assert.match(account, /auth_logout/);
    assert.match(account, /auth_login/);
    assert.doesNotMatch(
      account,
      /onRunCli\("auth_login"\)[\s\S]*onRunCli\("auth_logout"\)/,
    );
    assert.match(settings, /isSettingsDraftDirty|dirty/);
    assert.match(settings, /Discard unsaved|requestClose/);
    assert.doesNotMatch(settings, /J-06/);
    assert.match(security, /Security|security-sensitive|No sandbox/);
    assert.match(security, /from "@\/components\/ui\/Checkbox"/);
    assert.match(security, /from "@\/components\/ui\/Select"/);
    assert.match(draft, /isSettingsDraftDirty|settingsDraftEqual/);
    const checkbox = readSrc("components/ui/Checkbox.tsx");
    assert.match(checkbox, /type="checkbox"/);
    assert.match(checkbox, /ui-check/);
    // Face wrapper centers the 15px box on the first label line (1lh).
    assert.match(checkbox, /ui-check-face/);
    const chrome = readDesktopRoot("uno/shortcuts.chrome.ts");
    assert.match(chrome, /ui-check-face/);
    assert.match(chrome, /h-\[1lh\]/);
  });

  it("focus-visible tokens and FadeContent reduced-motion / default readable", () => {
    const base = readBaseStyles();
    const colors = readSrc("styles/defineColor.css");
    const fade = readSrc("components/react-bits/FadeContent.tsx");
    assert.match(colors, /--color-focus-ring/);
    assert.match(base, /:focus-visible/);
    assert.match(base, /prefers-reduced-motion/);
    assert.match(base, /\.rb-fade\s*\{[^}]*opacity:\s*1/s);
    assert.match(fade, /prefersReducedMotion|prefers-reduced-motion/);
    assert.match(fade, /rb-fade-pending/);
  });

  it("top-nav exposes context-drawer aria-expanded and session menu danger", () => {
    const top = readSrc("widgets/TopNavWidget.tsx");
    assert.match(top, /aria-expanded=\{props\.contextRailOpen\}/);
    assert.match(top, /aria-controls="context-rail"/);
    assert.doesNotMatch(top, /aria-pressed=\{props\.contextRailOpen\}/);
    assert.doesNotMatch(top, /role="tab"/);
    assert.doesNotMatch(top, /aria-selected/);
    const menu = readSrc("widgets/SessionMenuWidget.tsx");
    assert.match(menu, /danger:\s*true/);
    assert.match(menu, /forkSession|runSessionMenuAction/);
  });

  it("narrow shell collapses rail off-canvas and keeps top-nav full-bleed", () => {
    const shortcuts = readAllUnoShortcuts();
    const sideNav = readDesktopRoot("uno/shortcuts.sidenav.ts");
    const base = readSrc("styles/base.css");
    // Off-canvas rail is a JS-driven class, not a 900px media query, so the
    // main column can undock whenever the open right rail would crush it.
    assert.match(shortcuts, /"main-column-flush":\s*"ml-0"/);
    assert.match(shortcuts, /"top-nav-flush":\s*"left-0"/);
    assert.match(shortcuts, /"top-nav-rail-btn":/);
    assert.match(shortcuts, /"side-nav-offcanvas":/);
    // Narrow shell lives only in Uno (no duplicate base.css media query).
    assert.doesNotMatch(base, /@media \(max-width:\s*639px\)/);
    /*
     * Both slide states must be plain rules from uno.config. presetUno's own
     * `translate-x-[-100%]` / `translate-x-0` compose through --un-translate-*
     * vars that only its (disabled) preflight defines, so they resolved to
     * `transform: none` and the drawer sat fully on screen at every width with
     * the hamburger moving nothing. See the generated-CSS guard at the bottom
     * of this file for the check that covers the whole transform family.
     */
    // Scoped to the shortcut's own class list — the surrounding comment names
    // the broken spellings on purpose, so a whole-file negative would trip.
    const sideNavClasses =
      sideNav.match(/"side-nav":\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    const offcanvasClasses =
      sideNav.match(/"side-nav-offcanvas":\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(offcanvasClasses, /translate-x-full-left/);
    assert.match(offcanvasClasses, /data-\[open=true\]:translate-x-none/);
    assert.doesNotMatch(sideNavClasses, /translate-x-\[-100%\]|translate-x-0\b/);
    assert.doesNotMatch(
      offcanvasClasses,
      /translate-x-\[-100%\]|translate-x-0\b/,
    );
    assert.match(
      readDesktopRoot("uno.config.ts"),
      /\["translate-x-full-left",\s*\{\s*transform:\s*"translateX\(-100%\)"\s*\}\]/,
    );
    const top = readSrc("widgets/TopNavWidget.tsx");
    assert.match(top, /onToggleRail|top-nav-rail-btn/);
    const rail = readSrc("widgets/sessionRail/SessionRailView.tsx");
    assert.match(rail, /data-open|onClose|railOpen/);
    // Header collapse is always mounted (right of "Grok"), not hamburger-only.
    assert.match(rail, /side-nav-collapse-btn/);
    assert.match(rail, /onCollapse/);
    assert.match(rail, /PanelLeftClose/);
    assert.match(
      rail,
      /<div className="side-nav-header">[\s\S]*?side-nav-collapse-btn/,
    );
    assert.match(
      sideNav,
      /"side-nav-search":[\s\S]*?focus-visible:\(outline-none ring-2/,
    );
    // Field focus chrome is on the wrap (border color), not a second ring on the textarea.
    assert.match(
      shortcuts,
      /"composer-input-wrap":[\s\S]*?border-field/,
    );
    // Bound the value string so later shortcuts with ring-2 cannot false-match.
    assert.match(
      shortcuts,
      /"composer-input":\s*"[^"]*focus-visible:outline-none/,
    );
    assert.match(
      shortcuts,
      /"composer-input":\s*"[^"]*field-sizing:content/,
    );
    assert.doesNotMatch(
      shortcuts,
      /"composer-input":\s*"[^"]*focus-visible:\(outline-none ring-2/,
    );
    const live = readSrc("store/sessionStoreLive.ts");
    assert.match(live, /healSessionTimeline|tagSeedUserMessages/);
  });

  it("tool path chips and groups have dark-theme shortcuts (no native white buttons)", () => {
    const shortcuts = readAllUnoShortcuts();
    assert.match(shortcuts, /"tool-loc-link":/);
    assert.match(shortcuts, /"tool-locations":/);
    assert.match(shortcuts, /"turn-step":/);
    assert.match(shortcuts, /"turn-rail":/);
    assert.match(shortcuts, /"turn-block":/);
    assert.doesNotMatch(shortcuts, /msg-status-bar/);
    assert.doesNotMatch(shortcuts, /"item-process":/);
    assert.match(shortcuts, /"badge-ok":/);
    const base = readSrc("styles/base.css");
    assert.match(base, /button\s*\{[^}]*background-color:\s*transparent/s);
  });

  it("tool paths render workspace-relative and copy the absolute path", () => {
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    // Shortening needs the workspace root; the title carries a path too.
    assert.match(tool, /session\.workspace/);
    assert.match(tool, /toPathDisplay/);
    const head = readSrc("widgets/timeline/ToolCardHeadView.tsx");
    assert.match(head, /splitTitlePath/);
    assert.match(head, /PathLabelView/);
    const locations = readSrc("widgets/timeline/ToolLocationListView.tsx");
    assert.match(locations, /toPathDisplay/);
    assert.match(locations, /onDoubleClick/);
    // Copy must hand over the real path, never the shortened label.
    assert.match(locations, /onCopy\(display\.full\)/);
    assert.match(locations, /event\.detail > 1/);
    const editRow = readSrc("widgets/timeline/EditSummaryRowView.tsx");
    assert.match(editRow, /onDoubleClick=\{onCopy\}/);
    assert.match(editRow, /data-path=\{display\.full\}/);
    const label = readSrc("widgets/shared/stateless/PathLabelView.tsx");
    assert.match(label, /path-label-dir/);
    assert.match(label, /path-label-base/);
    const shortcuts = readAllUnoShortcuts();
    // One-line chips: only the directory half may be ellipsized.
    assert.match(shortcuts, /"path-label-dir":[^"]*"[^"]*text-ellipsis/);
    assert.match(shortcuts, /"path-label-base":[^"]*"[^"]*shrink-0/);
    // Preview head uses the wrap variants so a long file name is not clipped.
    assert.match(shortcuts, /"path-label-wrap":/);
    assert.match(shortcuts, /"path-label-base-wrap":[^"]*"[^"]*break-all/);
    const previewTitle =
      shortcuts.match(/"preview-title":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(previewTitle, /overflow-wrap:anywhere/);
    assert.doesNotMatch(previewTitle, /whitespace-nowrap/);
    const previewCodeTable =
      shortcuts.match(/"preview-code-table":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(previewCodeTable, /table-fixed/);
    const previewCodeScroll =
      shortcuts.match(/"preview-code-scroll":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(previewCodeScroll, /overflow-x-hidden/);
    assert.doesNotMatch(previewCodeScroll, /overflow-auto/);
    // Preview drawer head speaks the same path language as the timeline.
    const previewHead = readSrc("widgets/preview/PreviewHeadView.tsx");
    assert.match(previewHead, /PathLabelView/);
    assert.match(previewHead, /display=\{display\} wrap/);
    assert.match(previewHead, /data-path=\{display\.full\}/);
    assert.match(previewHead, /onDoubleClick=\{handleDoubleClick\}/);
    assert.match(previewHead, /CopiedCursorFlashView/);
    assert.doesNotMatch(previewHead, /path-copied-flag/);
    // Dead copy-class helper is gone now that the head owns a real copy path.
    assert.doesNotMatch(previewHead, /previewCopyClass/);
    const previewDrawer = readSrc("widgets/preview/PreviewDrawerWidget.tsx");
    assert.match(previewDrawer, /session\.workspace/);
    assert.match(previewDrawer, /toPathDisplay/);
  });

  it("turn orchestration: answer owns Copy/Markdown; narration steps do not", () => {
    const turnAnswer = readSrc("widgets/timeline/TurnAnswerView.tsx");
    assert.match(turnAnswer, /StreamingMarkdownView/);
    assert.match(turnAnswer, /title="Copy"/);
    assert.match(turnAnswer, /msg-action-btn/);
    const turnStep = readSrc("widgets/timeline/TurnStepView.tsx");
    assert.doesNotMatch(turnStep, /StreamingMarkdownView/);
    // No Copy button / action row on mid-turn narration steps.
    assert.doesNotMatch(turnStep, /msg-action|clipboard|title="Copy"/);
    const turnIndex = readSrc("widgets/timeline/index.ts");
    assert.match(turnIndex, /TurnBlockWidget/);
    assert.doesNotMatch(turnIndex, /ProcessGroupView/);
    const grouping = readSrc("lib/turnGrouping.ts");
    assert.match(grouping, /groupTimelineTurns|isTurnLive/);
    const wrap = readSrc("lib/goalWrapUp.ts");
    assert.match(wrap, /resolveGoalWrapUp|findGoalWrapUpUnitIndex/);
    const turnBlock = readSrc("widgets/timeline/TurnBlockWidget.tsx");
    assert.match(turnBlock, /fallbackAnswer/);
    assert.match(turnAnswer, /wrapUp/);
  });

  it("React Bits adaptations ship and wire into shell surfaces", () => {
    const index = readSrc("components/react-bits/index.ts");
    assert.match(index, /FadeContent|BlurText|ShinyText|StarBorder|SpotlightCard|ClickSpark|GlareHover/);
    const timeline = readSrc("widgets/timeline/TimelineView.tsx");
    assert.match(timeline, /BlurText|FadeContent|ShinyText/);
    const composer = readSrc("widgets/composer/ComposerWidget.tsx");
    assert.match(composer, /ClickSpark|StarBorder/);
    const rb = readSrc("styles/base.react-bits.css");
    assert.match(rb, /\.rb-shiny-text|\.rb-star-border|\.rb-spotlight-card/);
  });

  it("setModel/setMode call live bridge (not local-only) with pendingMode", () => {
    const store = readSrc("store/sessionStore.ts");
    assert.match(store, /live\.setModel/);
    assert.match(store, /live\.setMode/);
    assert.match(store, /promptQueue/);
    assert.match(store, /pendingMode/);
    assert.match(store, /armPendingModeTimeout|clearPendingModeTimer/);
  });

  it("sandbox honesty note exists for macOS", () => {
    const sbx = readSrc("lib/sandboxProfiles.ts");
    assert.match(sbx, /no-op/);
    assert.match(sbx, /Linux/);
  });

  it("overview, agents rail, tool group, fork/rewind surfaces exist", () => {
    const app = readSrc("App.tsx");
    assert.match(app, /MultiSessionOverviewWidget/);
    const overview = readSrc("widgets/MultiSessionOverviewWidget.tsx");
    assert.match(overview, /buildOverviewSessions/);
    // Search pins in the shell toolbar, not inside the scrolling body.
    assert.match(overview, /toolbar=\{/);
    assert.doesNotMatch(overview, /pe\?\.status \?\? c\.status/);
    assert.doesNotMatch(app, /TasksPanelWidget/);
    assert.match(app, /ContextDrawerWidget/);
    assert.match(app, /buildRewindCommand/);
    const agents = readSrc("widgets/agentsRail/AgentsPanelWidget.tsx");
    assert.match(agents, /AgentsRosterView|useAgentsPanelWidget/);
    const menu = readSrc("widgets/SessionMenuWidget.tsx");
    assert.match(menu, /forkSession|runSessionMenuAction/);
    const timeline = readSrc("widgets/timeline/TimelineView.tsx");
    const hook = readSrc("widgets/timeline/useTimelineWidget.ts");
    const model = readSrc("widgets/timeline/useTimelineModel.ts");
    const pipeline = readSrc("lib/timelinePipeline.ts");
    assert.match(pipeline, /buildTimelineRenderUnits/);
    assert.match(hook, /useTimelineModel/);
    assert.match(model, /buildTimelineRenderUnits/);
    assert.match(timeline, /TurnBlockWidget|TurnStepView/);
    // Residual tool/thought groups must not keep a parallel JSX tree.
    assert.doesNotMatch(timeline, /ToolGroupView|ThoughtGroupView/);
    assert.doesNotMatch(timeline, /groupTimelineProcess|ProcessGroupView/);
    assert.doesNotMatch(timeline, /msg-status-bar/);
    const settings = readSrc("widgets/SettingsPanelWidget.tsx");
    assert.match(settings, /denyRules|allowRules|effort/);
    assert.match(settings, /SettingsSpawnSectionView|SettingsSecuritySectionView/);
  });

  it("native theme, badge, diff hunk apply, media/ops commands ship", () => {
    const app = readSrc("App.tsx");
    assert.match(app, /setAttentionBadge|useAppShellWidget/);
    const lifecycle = readSrc("widgets/shell/useShellSessionLifecycle.ts");
    assert.match(lifecycle, /setAttentionBadge/);
    // Theme toggle lives in Settings + ⌘K (not session ⋯)
    const paletteLib = readSrc("lib/commandPalette.ts");
    assert.match(paletteLib, /toggle_theme|Toggle light/);
    assert.match(paletteLib, /prefill_imagine|\/imagine|usage|privacy|release-notes/);
    assert.match(paletteLib, /imagine-video|prefillComposer/);
    // Kind / title / description share one column template (ACTION vs COMMAND
    // must not shift the text columns).
    const paletteChrome = readDesktopRoot("uno/shortcuts.chrome.ts");
    assert.match(
      paletteChrome,
      /palette-item[\s\S]{0,280}?grid-cols-\[5\.5rem_minmax\(0,1fr\)_minmax\(0,1fr\)\]/,
    );
    const paletteWidget = readSrc("widgets/CommandPaletteWidget.tsx");
    assert.match(paletteWidget, /CommandPaletteItemView/);
    assert.doesNotMatch(paletteWidget, /sessionsToPaletteItems/);
    const paletteHook = readSrc("widgets/useCommandPaletteWidget.ts");
    assert.match(paletteHook, /buildPaletteCatalog/);
    assert.match(paletteHook, /selectMcpRows|selectSkillRows/);
    assert.doesNotMatch(paletteHook, /sessionsToPaletteItems/);
    const paletteRow = readSrc("widgets/CommandPaletteItemView.tsx");
    assert.match(paletteRow, /OverflowTextView/);
    assert.match(paletteLib, /kind: \"mcp\"|kind: \"skill\"/);
    assert.match(paletteLib, /buildPaletteCatalog/);
    const composer = readSrc("widgets/composer/useComposerWidget.ts");
    assert.match(composer, /useComposerFocusEvents/);
    assert.match(composer, /useComposerSlashCatalog/);
    const slashHook = readSrc("widgets/composer/useComposerSlashCatalog.ts");
    assert.match(slashHook, /resolveSlashCatalog/);
    assert.match(slashHook, /loadEnv\(runCli\)/);
    const slashLib = readSrc("lib/slashCatalog.ts");
    assert.match(slashLib, /withCachedSlashCatalog/);
    assert.match(slashLib, /desktopSlashCommands/);
    assert.match(readSrc("lib/slashBuiltins.ts"), /name: \"model\"|name: \"effort\"/);
    assert.match(composer, /bindTryLocalSlashFromBar|tryLocalSlash/);
    assert.match(composer, /applyLocalSlashDraftFromBar|applyArgDraft/);
    assert.match(paletteLib, /prefill_model|prefill_effort/);
    assert.doesNotMatch(
      readSrc("widgets/composer/composerCompletion.ts"),
      /Waiting for live grok-build to provide commands/,
    );
    const composerFocus = readSrc("widgets/composer/useComposerFocusEvents.ts");
    assert.match(composerFocus, /PREFILL_COMPOSER_EVENT|prefill-composer/);
    assert.match(composerFocus, /FOCUS_COMPOSER_EVENT|focus-composer/);
    const diff = readSrc("widgets/preview/DiffReviewWidget.tsx");
    assert.match(diff, /applyHunkDecisions/);
    assert.match(diff, /writeWorkspaceFile|Accept|Reject/);
    // Review shell no longer owns legacy row chrome (single paint via PreviewDiff).
    assert.doesNotMatch(diff, /diff-line|diff-gutter/);
    const themeCss = readSrc("styles/defineColor.css");
    assert.match(themeCss, /data-theme="light"/);
    assert.match(themeCss, /--seed-brand/);
    assert.match(themeCss, /color-mix\(in oklch/);
    // Diff seeds decoupled from success/danger; row wash hard-capped at 10%.
    assert.match(themeCss, /--seed-diff-add/);
    assert.match(
      themeCss,
      /--color-diff-add-bg[\s\S]{0,160}?--seed-diff-add-wash\)\s+10%/,
    );
    assert.match(themeCss, /data-theme="light"[\s\S]*?--seed-diff-add:/);
    assert.match(themeCss, /data-palette="blue"/);
    assert.match(themeCss, /#057aff|#057AFF/i);
    assert.match(themeCss, /#a550a6|#A550A6/i);
    assert.match(themeCss, /#f74f9f|#F74F9F/i);
    assert.match(themeCss, /#ff5257|#FF5257/i);
    assert.match(themeCss, /#f78219|#F78219/i);
    assert.match(themeCss, /#ffc600|#FFC600/i);
    assert.match(themeCss, /#62ba46|#62BA46/i);
    assert.match(themeCss, /#8c8c8b|#8C8C8B/i);
    assert.match(themeCss, /--scheme-brand-in-surface/);
    const settings = readSrc("widgets/SettingsPanelWidget.tsx");
    const appearance = readSrc("widgets/settings/SettingsAppearanceSectionView.tsx");
    assert.match(settings, /pickPalette/);
    assert.match(appearance, /COLOR_PALETTE_OPTIONS|UI color|Appearance/);
    // F-CTX-01: Settings toggle + composer ring left of Send.
    assert.match(appearance, /Show context usage|showContextUsage/);
    assert.match(appearance, /Show weekly remaining|showWeeklyUsage/);
    assert.match(settings, /saveContextUsagePrefs|showContextUsage/);
    assert.match(settings, /showWeeklyUsage|setWeeklyUsageVisible/);
    const composerWidget = readSrc("widgets/composer/ComposerWidget.tsx");
    assert.match(composerWidget, /ComposerContextUsageView|contextUsageDisplay/);
    assert.match(composerWidget, /ComposerWeeklyUsageView|weeklyUsageDisplay/);
    const contextUsageHook = readSrc("widgets/composer/useContextUsageDisplay.ts");
    assert.match(contextUsageHook, /isContextUsageReady/);
    const usageRevealCss = readBaseStyles();
    assert.match(usageRevealCss, /@keyframes composer-usage-reveal/);
    assert.match(usageRevealCss, /margin-inline-end:\s*-0\.375rem/);
    const contextTip = readSrc("widgets/composer/ComposerContextUsageView.tsx");
    assert.match(contextTip, /tooltip\.occupancyLine/);
    assert.match(contextTip, /tooltip\.usageLine/);
    assert.match(contextTip, /composer-usage-tip-divider/);
    assert.match(contextTip, /onMouseDown/);
    const weeklyTipView = readSrc("widgets/composer/ComposerWeeklyUsageView.tsx");
    assert.match(weeklyTipView, /onMouseDown/);
    const contextPrefs = readSrc("lib/contextUsagePrefs.ts");
    assert.match(contextPrefs, /showContextUsage|CONTEXT_USAGE_PREFS_KEY/);
    assert.match(contextPrefs, /showWeeklyUsage/);
    /*
     * The usage tip must center on the ring. presetUno's own translate/scale
     * utilities compose through --un-* vars that only its preflight defines,
     * and preflight is off here, so they resolve to `transform:none` and the
     * bubble parks its left edge on the ring center. Every transform in a
     * shortcut has to come from a plain rule in uno.config.
     */
    const composerShortcutSrc = readDesktopRoot("uno/shortcuts.composer.ts");
    const usageSvg =
      composerShortcutSrc.match(/"composer-usage-svg":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(usageSvg, /\bw-14px\b/);
    assert.match(usageSvg, /\bh-14px\b/);
    const usageTip =
      composerShortcutSrc.match(/"composer-usage-tip":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(usageTip, /\bleft-1\/2\b/);
    assert.match(usageTip, /\btranslate-x-center\b/);
    assert.match(usageTip, /\boverflow-hidden\b/);
    assert.doesNotMatch(usageTip, /-translate-x-1\/2/);
    const usageTipLine =
      composerShortcutSrc.match(/"composer-usage-tip-line":\s*"([^"]+)"/)?.[1] ??
      "";
    assert.match(usageTipLine, /\bbreak-words\b/);
    assert.doesNotMatch(usageTipLine, /whitespace-nowrap/);
    // Click focus must not pin the bubble; keyboard still uses :focus-visible.
    assert.match(usageTip, /group-hover:opacity-100/);
    assert.match(usageTip, /group-focus-visible:opacity-100/);
    assert.doesNotMatch(usageTip, /group-focus-within/);
    const weeklyTip =
      composerShortcutSrc.match(/"composer-weekly-tip":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(weeklyTip, /group-hover:opacity-100/);
    assert.match(weeklyTip, /group-focus-visible:opacity-100/);
    assert.doesNotMatch(weeklyTip, /group-focus-within/);
    // Bar clusters must not shrink (min-w-0 let Weekly paint over Mic).
    const composerBarLeft =
      composerShortcutSrc.match(/"composer-bar-left":\s*"([^"]+)"/)?.[1] ?? "";
    const composerBarRight =
      composerShortcutSrc.match(/"composer-bar-right":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(composerBarLeft, /\bshrink-0\b/);
    assert.match(composerBarRight, /\bshrink-0\b/);
    assert.match(composerBarRight, /\bml-auto\b/);
    assert.doesNotMatch(composerBarLeft, /\bmin-w-0\b/);
    assert.doesNotMatch(composerBarRight, /\bmin-w-0\b/);
    const unoConfig = readDesktopRoot("uno.config.ts");
    assert.match(
      unoConfig,
      /\["translate-x-center",\s*\{\s*transform:\s*"translateX\(-50%\)"\s*\}\]/,
    );
    const palette = readSrc("lib/colorPalette.ts");
    assert.match(palette, /applyPalette|loadPalette/);
    const compat = readSrc("lib/compatToggles.ts");
    assert.match(compat, /GROK_.*_ENABLED/);
    assert.match(compat, /COMPAT_TOGGLE_COUNT = 10/);
  });

  it("composer drag-drop and image ContentBlock send path ship", () => {
    const input = readSrc("widgets/composer/ComposerInputView.tsx");
    assert.match(input, /onDrop|onDragOver/);
    assert.match(input, /data-drag-over|data-state/);
    assert.match(input, /composer-attachment-thumb|attachmentPreviewSrc/);
    assert.match(input, /COMPOSER_THUMB_PX/);
    assert.match(input, /width=\{COMPOSER_THUMB_PX\}/);
    assert.match(input, /canInlinePreviewAttachment|openAttachmentExternally/);
    assert.match(input, /ImageLightboxView|handleOpenAttachment/);
    assert.match(input, /onRemoveAttachment/);
    const hook = readSrc("widgets/composer/useComposerWidget.ts");
    const attachments = readSrc("widgets/composer/useComposerAttachments.ts");
    assert.match(attachments, /processDataTransfer|handleDrop/);
    assert.match(attachments, /buildPromptBlocks|acceptImageAttachment/);
    assert.match(attachments, /showNotice/);
    assert.match(attachments, /openFilePicker|handleFileInputChange|fileInputRef/);
    // Prefer showPicker so focusing a clipped input does not scroll/jitter the dock.
    assert.match(attachments, /showPicker/);
    const composerShortcuts = readDesktopRoot("uno/shortcuts.composer.ts");
    assert.match(
      composerShortcuts,
      /"composer-attach-input":\s*"[^"]*fixed[^"]*h-0[^"]*w-0/,
    );
    // Locked 56×56 tile + out-of-flow thumb (large paste must not reflow the dock).
    assert.match(
      composerShortcuts,
      /"composer-attachment":\s*"[^"]*min-w-14[^"]*max-w-14/,
    );
    assert.match(
      composerShortcuts,
      /"composer-attachment-thumb":\s*"[^"]*absolute inset-0/,
    );
    assert.doesNotMatch(composerShortcuts, /composer-attach-input[\s\S]{0,200}clip:rect/);
    assert.match(hook, /useComposerAttachments|agentCapabilities/);
    assert.doesNotMatch(
      attachments,
      /agentSupportsImageInput\(\{\s*promptCapabilities:\s*\{\s*image:\s*false/,
    );
    const store = readSrc("store/sessionStore.ts");
    const prompt = readSrc("store/sessionStorePrompt.ts");
    assert.match(store, /sendPromptAction|blocks/);
    assert.match(prompt, /handle\.prompt\(text,\s*sid/);
  });

  it("env whitelist and permission deny-wins modules ship in bridge", () => {
    const env = readDesktopRoot("../bridge/src/envWhitelist.ts");
    assert.match(env, /filterEnvForGrokChild/);
    assert.match(env, /XAI_API_KEY/);
    const perm = readDesktopRoot("../bridge/src/permissionRules.ts");
    assert.match(perm, /evaluatePermissionRules/);
    assert.match(perm, /deny/);
    const spawn = readDesktopRoot("../bridge/src/spawnGrok.ts");
    assert.match(spawn, /filterEnvForGrokChild/);
  });

  it("product UI is live-only (no mock agent entry)", () => {
    const app = readSrc("App.tsx");
    assert.match(app, /useAppShellWidget|selectSession/);
    assert.doesNotMatch(app, /startMockAgent|loadDemoFixture|Mock agent/);
    const store = readSrc("store/sessionStore.ts");
    assert.doesNotMatch(store, /createMockAcpPair/);
    const live = readSrc("store/sessionStoreLive.ts");
    assert.match(live, /DEFAULT_ALWAYS_APPROVE = false/);
    assert.doesNotMatch(store, /alwaysApprove:\s*true/);
    assert.doesNotMatch(live, /alwaysApprove:\s*true/);
  });

  it("New chat is a local draft; real session is forceNew on first send", () => {
    const nav = readSrc("store/sessionStoreNavigation.ts");
    // newSessionAction must not call startLiveBridgeSession / forceNew.
    const newSessionFn = nav.slice(
      nav.indexOf("export async function newSessionAction"),
      nav.indexOf("export async function setWorkspaceAction"),
    );
    assert.match(newSessionFn, /send a message to start|local New chat draft/i);
    assert.doesNotMatch(newSessionFn, /startLiveBridgeSession/);
    assert.doesNotMatch(newSessionFn, /forceNew/);
    // Every New chat entry (rail / ⌘N / palette / ⋯) focuses the composer.
    assert.match(newSessionFn, /focusComposer/);
    const prompt = readSrc("store/sessionStorePrompt.ts");
    assert.match(prompt, /ensureSessionForSend|forceNew:\s*true/);
    assert.match(prompt, /waitForCanvasSessionId|creatingSession/);
    const live = readSrc("store/sessionStoreLive.ts");
    assert.match(live, /resolveCanvasFollow/);
  });

  it("session rail is side-nav with workspace groups and workspace footer nav", () => {
    const rail = readSrc("widgets/sessionRail/SessionRailView.tsx");
    const railHook = readSrc("widgets/sessionRail/useSessionRailWidget.ts");
    const railWidget = readSrc("widgets/sessionRail/SessionRailWidget.tsx");
    assert.match(railWidget, /useSessionRailWidget|SessionRailView/);
    assert.match(rail, /side-nav/);
    assert.doesNotMatch(rail, /useSessionStore/);
    assert.match(railHook, /groupSessionsByProject/);
    assert.doesNotMatch(railHook, /groupSessionsByTime/);
    assert.match(rail, /SessionRailProjectGroupView/);
    assert.match(rail, /SessionRailFooterView/);
    // Chats with no workspace get their own section, not a "(no project)"
    // folder inside PROJECTS (and not a silent drop from the rail).
    assert.match(rail, /SessionRailNoProjectGroupView/);
    assert.match(railHook, /splitNoProjectSessions/);
    const loose = readSrc("widgets/SessionRailNoProjectGroupView.tsx");
    assert.match(loose, /No project/);
    assert.match(loose, /loose-group/);
    assert.doesNotMatch(loose, /useSessionStore/);
    // Quiet section label (chevron + caps + count). A 14px stroke glyph next
    // to 10px tracked type reads as a fake folder and looks noisy.
    assert.doesNotMatch(loose, /MessagesSquare|loose-group-icon/);
    // Pin is per-session, not per folder.
    assert.match(railHook, /orderGroupsBySessionPin/);
    assert.match(railHook, /toggleCollapsedWorkspace|onToggleCollapse/);
    assert.match(railHook, /loadSessionRailPrefs|saveSessionRailPrefs/);
    assert.match(railHook, /expandWorkspacePreview|onExpandPreview/);
    assert.match(railHook, /collapseWorkspacePreview|onCollapsePreview/);
    assert.match(railHook, /togglePinnedSession|onTogglePin/);
    assert.match(railHook, /renameSession/);
    assert.match(railHook, /beginRename|commitRename/);
    assert.doesNotMatch(railHook, /togglePinnedWorkspace|pinnedWorkspaces/);
    assert.match(rail, /New chat/);
    assert.match(railHook, /selectSession/);
    // Project switcher is session context on the composer, not the rail.
    assert.doesNotMatch(rail, /ProjectSwitcherWidget/);
    assert.doesNotMatch(rail, /backgroundColor|color:\s*['"`]#|rgb\(/);
    assert.match(rail, /project-section-label/);
    assert.match(rail, /project-section-head/);
    // PROJECTS is outside the scrollport (no sticky bleed); workspace names sticky.
    assert.match(
      rail,
      /project-section-head[\s\S]*?side-nav-scroll/,
    );
    const sideNavShortcuts = readDesktopRoot("uno/shortcuts.sidenav.ts");
    assert.match(
      sideNavShortcuts,
      /"project-group-header":\s*"sticky top-0/,
    );
    assert.match(
      sideNavShortcuts,
      /"project-group-header":[\s\S]*?bg-sidebar/,
    );
    // Sticky folder hover must stay opaque (sidebar-hover), not white-faint —
    // translucent hover lets scrolled session titles bleed through the name.
    // The fill rides a rounded ::before overlay; the header's own box stays
    // square so the opaque mask has no corner notches to leak through.
    {
      const header =
        sideNavShortcuts.match(
          /"project-group-header":\s*"([^"]+)"/,
        )?.[1] ?? "";
      assert.match(header, /hover:before:bg-sidebar-hover/);
      assert.doesNotMatch(header, /hover:bg-white-/);
      assert.match(header, /before:\([^)]*rounded-8px/);
      // Radius lives on the overlay only — the masking box itself is square.
      const headerBox = header.replace(/before:\([^)]*\)/g, "");
      assert.doesNotMatch(headerBox, /rounded-/);
    }
    const composer = readSrc("widgets/composer/ComposerWidget.tsx");
    assert.match(composer, /ProjectSwitcherWidget/);
    // Project switcher + create dialog (Codex-style); lock when session has content.
    const switcher = readSrc("widgets/project/ProjectSwitcherWidget.tsx");
    assert.match(switcher, /sessionHasConversationContent/);
    assert.match(switcher, /setWorkspace/);
    assert.match(switcher, /noProject|resolvePreferredWorkspace/);
    assert.match(switcher, /CreateProjectDialogView/);
    const createDlg = readSrc("widgets/project/CreateProjectDialogView.tsx");
    assert.match(createDlg, /Create project/);
    assert.match(createDlg, /Source folder/);
    const menu = readSrc("widgets/project/ProjectSwitcherMenuView.tsx");
    assert.match(menu, /Work without a project/);
    assert.match(menu, /Search projects/);
    const composerShortcuts = readDesktopRoot("uno/shortcuts.composer.ts");
    assert.match(
      composerShortcuts,
      /"project-switcher-menu":[\s\S]*?bottom-\[calc\(100%/,
    );
    // Footer: session density + workspace menu (Settings / Tasks / …).
    // Quota lives with the menu view so open can suppress the light track.
    const footer = readSrc("widgets/SessionRailFooterView.tsx");
    assert.match(footer, /SessionRailWorkspaceMenuWidget/);
    assert.match(footer, /catalogLength/);
    const workspaceMenu = readSrc("widgets/SessionRailWorkspaceMenuView.tsx");
    assert.match(workspaceMenu, /aria-label="Workspace"/);
    assert.match(workspaceMenu, /side-nav-workspace-menu/);
    assert.match(workspaceMenu, /side-nav-quota/);
    assert.match(workspaceMenu, /side-nav-quota-suppressed/);
    const workspaceWidget = readSrc(
      "widgets/SessionRailWorkspaceMenuWidget.tsx",
    );
    assert.match(workspaceWidget, /detail:\s*panel|open-panel|open-environment/);
    assert.match(workspaceWidget, /settings|overview|environment/);
    assert.doesNotMatch(workspaceWidget, /"tasks"/);
    assert.doesNotMatch(workspaceWidget, /"extensions"/);
    assert.match(workspaceWidget, /reconnect/);
    const groupView = readSrc("widgets/SessionRailProjectGroupView.tsx");
    assert.match(groupView, /project-group-name/);
    assert.match(groupView, /project-group-count/);
    // Folder header is collapse-only; pin must not live on the project row.
    assert.doesNotMatch(groupView, /onTogglePin|project-group-pin/);
    assert.match(groupView, /project-group-chevron|ChevronDown/);
    assert.match(groupView, /FolderOpen|Folder/);
    assert.match(groupView, /Show .+ more|Show more|SessionRailGroupMoreView/);
    assert.match(groupView, /PROJECT_SESSION_PREVIEW/);
    assert.match(groupView, /PROJECT_SESSION_EXPANDED_CAP/);
    assert.match(groupView, /onToggleCollapse/);
    // Collapse / "Show more" / "Show less" are controlled from rail prefs.
    assert.match(groupView, /previewExpanded/);
    assert.match(groupView, /onExpandPreview/);
    assert.match(groupView, /onCollapsePreview/);
    assert.match(groupView, /project-group-session-list-scroll/);
    assert.doesNotMatch(groupView, /useState/);
    const moreView = readSrc("widgets/SessionRailGroupMoreView.tsx");
    assert.match(moreView, /Show \{.*\} more/);
    assert.match(moreView, /Show less/);
    assert.doesNotMatch(moreView, /useState/);
    const looseGroup = readSrc("widgets/SessionRailNoProjectGroupView.tsx");
    assert.match(looseGroup, /onCollapsePreview/);
    assert.match(looseGroup, /SessionRailGroupMoreView/);
    assert.match(looseGroup, /project-group-session-list-scroll/);
    // Title | trailing action parent (rename + pin + remove). No leading status dot.
    const sessionRow = readSrc("widgets/SessionRailSessionRowView.tsx");
    assert.match(sessionRow, /SessionRailSessionActionsView/);
    assert.doesNotMatch(sessionRow, /sess-status/);
    assert.match(sessionRow, /onTogglePin/);
    // Inline rename: double-click title + reserved control next to pin.
    assert.match(sessionRow, /onBeginRename/);
    assert.match(sessionRow, /onCommitRename/);
    assert.match(sessionRow, /SessionRailSessionTitleView/);
    const sessionActions = readSrc(
      "widgets/SessionRailSessionActionsView.tsx",
    );
    assert.match(sessionActions, /sess-actions/);
    assert.match(sessionActions, /sess-btns/);
    assert.doesNotMatch(sessionActions, /sess-meta/);
    assert.match(sessionActions, /sess-pin/);
    assert.match(sessionActions, /sess-rename/);
    assert.match(sessionActions, /sess-remove/);
    const titleView = readSrc("widgets/SessionRailSessionTitleView.tsx");
    assert.match(titleView, /sess-title-input/);
    assert.match(titleView, /onDoubleClick/);
    assert.doesNotMatch(titleView, /style=\{\{/);
    // Drag reorder within a project (user order > recency auto-sort).
    assert.match(sessionRow, /draggable/);
    assert.match(sessionRow, /onReorder/);
    assert.match(railHook, /applyWorkspaceSessionOrder|moveSessionIdInOrder/);
    assert.match(railHook, /sessionOrderByWorkspace/);
    const shortcuts = readDesktopRoot("uno/shortcuts.sidenav.ts");
    const appShortcuts = readDesktopRoot("uno/shortcuts.ts");
    assert.match(appShortcuts, /sideNavShortcuts|shortcuts\.sidenav/);
    assert.match(appShortcuts, /shellShortcuts|timelineShortcuts|composerShortcuts|chromeShortcuts/);
    assert.match(
      shortcuts,
      /"sess-row":[\s\S]*?grid-cols-\[minmax\(0,1fr\)_auto\]/,
    );
    assert.match(shortcuts, /"sess-actions":/);
    assert.match(shortcuts, /"sess-btns":/);
    // Cluster hugs the track's right edge so the trailing × keeps the same
    // right edge as the row timestamp; 2px gaps keep the glyphs from welding.
    const btnsShortcut = shortcuts.match(/"sess-btns":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(btnsShortcut, /justify-end/);
    assert.match(btnsShortcut, /w-full/);
    assert.match(btnsShortcut, /gap-\[2px\]/);
    assert.doesNotMatch(shortcuts, /"sess-status"/);
    assert.match(
      shortcuts,
      /"project-group-name":\s*"min-w-0 flex-1[\s\S]*?text-nav font-normal/,
    );
    // text-nav owns line-height; a leading-* here loses on Uno emit order
    // and a tight --line-height-nav-item clips descenders (g/y/p).
    const groupNameShortcut =
      shortcuts.match(/"project-group-name":\s*"([^"]+)"/)?.[1] ?? "";
    assert.doesNotMatch(groupNameShortcut, /\bleading-/);
    // Ellipsis is horizontal only — overflow-hidden shears "grok-desktop".
    assert.match(groupNameShortcut, /\boverflow-x-hidden\b/);
    assert.doesNotMatch(groupNameShortcut, /\boverflow-hidden\b/);
    const sessTitleShortcut =
      shortcuts.match(/"sess-title":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(sessTitleShortcut, /\btext-nav\b/);
    assert.doesNotMatch(sessTitleShortcut, /\bleading-/);
    assert.match(sessTitleShortcut, /\boverflow-x-hidden\b/);
    assert.doesNotMatch(sessTitleShortcut, /\boverflow-hidden\b/);
    const tokens = readSrc("styles/defineColor.css");
    assert.match(tokens, /--line-height-nav-item:\s*20px;/);
    // Folder / loose-group rows: 36px in px. rem h-8 / min-h-8 collapse to
    // 26px under html 13px and clip "grok-desktop" (this has regressed).
    {
      const folderHeader =
        shortcuts.match(/"project-group-header":\s*"([^"]+)"/)?.[1] ?? "";
      const folderMain =
        shortcuts.match(/"project-group-main":\s*"([^"]+)"/)?.[1] ?? "";
      const looseHeader =
        shortcuts.match(/"loose-group-header":\s*"([^"]+)"/)?.[1] ?? "";
      assert.match(folderHeader, /min-h-\[36px\]/);
      assert.match(folderMain, /h-\[36px\]/);
      assert.match(looseHeader, /min-h-\[36px\]/);
      assert.doesNotMatch(folderHeader, /\bmin-h-8\b|\bh-8\b/);
      assert.doesNotMatch(folderMain, /\bmin-h-8\b|\bh-8\b/);
      assert.doesNotMatch(looseHeader, /\bmin-h-8\b|\bh-8\b/);
    }
    assert.match(shortcuts, /"project-section-label":/);
    assert.match(shortcuts, /"project-group-sessions":/);
    assert.match(shortcuts, /"project-group-session-list":/);
    assert.match(
      shortcuts,
      /"project-group-session-list-scroll":[\s\S]*?max-h-\[calc\(36px\*8/,
    );
    {
      const moreChip =
        shortcuts.match(/"project-group-more":\s*"([^"]+)"/)?.[1] ?? "";
      assert.match(moreChip, /appearance-none/);
      assert.match(moreChip, /rounded-7px/);
      assert.match(moreChip, /overflow-hidden/);
      assert.match(moreChip, /h-\[28px\]/);
    }
    // Active selection is elevated fill + medium title only (no border ring /
    // left accent bar / inset crescent — those fight rounded-7px and read
    // loud on the rail).
    {
      const active =
        shortcuts.match(/"sess-row-active":\s*"([^"]+)"/)?.[1] ?? "";
      assert.match(active, /bg-high/);
      assert.doesNotMatch(active, /shadow-\[inset_0_0_0_1px_/);
      assert.match(active, /sess-title.*font-medium|font-medium.*sess-title/);
      assert.doesNotMatch(active, /inset_2px|before:\(content-/);
    }
    // Folder of the selected chat is marked so the current project reads when
    // its row scrolls off / the group collapses: all names sit at full primary
    // ink; active lifts weight (font-medium) + folder glyph + tree guide.
    // Parent selectors only — same-element overrides lose on Uno emit order.
    {
      const groupActive =
        shortcuts.match(/"project-group-active":\s*"([^"]+)"/)?.[1] ?? "";
      assert.match(groupActive, /\[&_\.project-group-name\]:font-medium\b/);
      assert.doesNotMatch(groupActive, /\[&_\.project-group-name\]:text-fg\b/);
      assert.match(groupActive, /\[&_\.project-group-folder\]:/);
      assert.match(
        groupActive,
        /\[&_\.project-group-sessions\]:before:bg-line-/,
      );
      assert.doesNotMatch(groupActive, /bg-white-|bg-sidebar/);
      const groupName =
        shortcuts.match(/"project-group-name":\s*"([^"]+)"/)?.[1] ?? "";
      assert.match(groupName, /\btext-fg\b/);
      assert.doesNotMatch(groupName, /text-fg-secondary/);
      assert.match(groupView, /project-group-active/);
      assert.match(railHook, /selectedWorkspace/);
      assert.match(rail, /selectedWorkspace/);
    }
    // Folder count stays visible (no hover-hide); session actions own one parent track.
    // Px 18×18 + matching line-height so the digit is optically centered
    // (rem h-4.5 + leading-none sat "1" high in the pill).
    const countShortcut = shortcuts.match(
      /"project-group-count":\s*"([^"]+)"/,
    );
    assert.ok(countShortcut?.[1], "project-group-count shortcut present");
    assert.doesNotMatch(countShortcut[1], /group-hover:opacity-0/);
    assert.match(countShortcut[1], /h-\[18px\]/);
    assert.match(countShortcut[1], /min-w-\[18px\]/);
    assert.match(countShortcut[1], /leading-\[18px\]/);
    assert.doesNotMatch(countShortcut[1], /\bh-4\.5\b|\bmin-w-4\.5\b|\bleading-none\b/);
    assert.match(shortcuts, /"sess-pin":/);
    assert.match(shortcuts, /"sess-pin-active":/);
    assert.match(shortcuts, /"sess-rename":/);
    assert.match(shortcuts, /"sess-title-input":/);
    // Rename field must not grow the row or paint a focus ring / border.
    const titleInputShortcut =
      shortcuts.match(/"sess-title-input":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(titleInputShortcut, /border-none/);
    assert.match(titleInputShortcut, /h-\[20px\]/);
    assert.doesNotMatch(titleInputShortcut, /ring-2|shadow-\[/);
    // Shared 14×28 slot so hover-reveal does not jitter. Values must be
    // string literals (a shared const crashes Uno's jiti config reload).
    const renameShortcut =
      shortcuts.match(/"sess-rename":\s*"([^"]+)"/)?.[1] ?? "";
    const pinShortcut =
      shortcuts.match(/"sess-pin":\s*"([^"]+)"/)?.[1] ?? "";
    const removeShortcut =
      shortcuts.match(/"sess-remove":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(renameShortcut, /w-\[14px\] h-\[28px\]/);
    assert.equal(renameShortcut, pinShortcut);
    assert.equal(renameShortcut, removeShortcut);
    assert.doesNotMatch(shortcuts, /const sessActionBtn/);
    assert.match(
      shortcuts,
      /"sess-row-editing":[\s\S]*?\[&_\.sess-rename\]:\(opacity-100/,
    );
    // Pinned visibility must win over base `.sess-pin { opacity:0 }` via parent
    // selector — same-element active class alone loses on Uno cascade order.
    assert.match(
      shortcuts,
      /"sess-row-pinned":[\s\S]*?\[&_\.sess-pin\]:\(opacity-100/,
    );
    assert.match(shortcuts, /"sess-time":[\s\S]*?group-hover:opacity-0/);
    assert.match(shortcuts, /"sess-actions":[\s\S]*?w-\[56px\]/);
    assert.match(shortcuts, /"sess-time":[\s\S]*?w-\[24px\]/);
    assert.doesNotMatch(shortcuts, /"sess-meta"/);
    // Close is a sibling 14×28 slot, not a right-aligned overlay in the time column.
    assert.match(removeShortcut, /p-0/);
    assert.match(removeShortcut, /justify-center/);
    assert.match(removeShortcut, /w-\[14px\] h-\[28px\]/);
    assert.doesNotMatch(removeShortcut, /inset-0|absolute right-0/);
    // Hover-reveal pin / time / remove snap — no opacity transition.
    const timeShortcut = shortcuts.match(/"sess-time":\s*"([^"]+)"/)?.[1] ?? "";
    assert.doesNotMatch(removeShortcut, /transition-opacity|duration-reveal/);
    assert.doesNotMatch(timeShortcut, /transition-opacity|duration-reveal/);
  });

  it("tool card normalizes array content and plan empty is en-US", () => {
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    assert.match(tool, /normalizeToolContentParts|summarizeEditContent/);
    // Timeline no longer embeds full interactive review; summary + openPreview only
    assert.match(tool, /EditSummaryRowView/);
    assert.match(tool, /openPreview/);
    // Large tool dumps collapse by default (Show full output).
    assert.match(tool, /Show full output|tool-content-collapsed|shouldCollapseToolText/);
    assert.doesNotMatch(tool, /DiffReview(View|Widget)/);
    assert.doesNotMatch(tool, /window\.open\(`file:\/\//);
    const diff = readSrc("widgets/preview/DiffReviewWidget.tsx");
    assert.match(diff, /mini-diff|applyHunkDecisions/);
    // Interactive gap band + single-column row chrome ship in preview widgets.
    const gapBand = readSrc("widgets/preview/DiffGapBandView.tsx");
    assert.match(gapBand, /onRevealTop|onRevealBottom|onRevealAll/);
    const diffView = readSrc("widgets/preview/PreviewDiffView.tsx");
    assert.doesNotMatch(diffView, /preview-diff-hunk-head|@@ −/);
    const plan = readSrc("widgets/PlanPanelView.tsx");
    assert.match(plan, /No plan yet/);
  });

  it("diff full-file: Apply gate, gap positions, Changes prefs, single nowrap scroll", () => {
    const review = readSrc("widgets/preview/DiffReviewWidget.tsx");
    // Apply must go through whole-file check; never write a raw window fragment.
    assert.match(review, /canApplyWholeFile|diskText === |fullFile/);
    assert.match(review, /ensureFullFile|useDiffFullFile/);
    assert.match(review, /applyDisabled|canApply/);

    const band = readSrc("widgets/preview/DiffGapBandView.tsx");
    assert.match(band, /position|leading|trailing/);
    assert.match(band, /ChevronsUpDown/);
    assert.match(band, /REVEAL_DUAL_ABOVE|data-gap-position/);

    const list = readSrc("widgets/preview/PreviewChangeListView.tsx");
    // Main Changes entry must surface wrap / dual / show-full prefs (not hideToolbar-only).
    assert.match(list, /viewPrefs|onViewPrefsChange|DiffChangeListChrome/);
    assert.match(list, /PathLabelView|toPathDisplay/);
    assert.match(list, /hideToolbar/);
    // hideToolbar is intentional when chrome owns prefs — chrome must still expose them.
    const fileSection = readSrc("widgets/preview/DiffFileSectionView.tsx");
    assert.match(fileSection, /PathLabelView/);
    const chrome = readSrc("widgets/preview/DiffChangeListChrome.tsx");
    // Show full file is a sticky toggle (preferFullFile) — off returns to change-only fragments.
    assert.match(chrome, /Wrap|Dual|Show full file|onViewPrefsChange/);
    assert.match(chrome, /preferFullFile/);
    // Icon + label share each button; CSS picks the face from leftover width.
    assert.match(chrome, /preview-change-summary-action-icon/);
    assert.match(chrome, /preview-change-summary-action-label/);
    assert.match(chrome, /UnfoldVertical|WrapText|Columns2|ChevronsDownUp/);
    // Summary counts stay nowrap; host measures the strip for sticky offset.
    assert.match(chrome, /preview-change-summary-label/);
    assert.match(chrome, /chromeRef/);
    assert.match(list, /ResizeObserver|offsetHeight|--preview-summary-h/);
    assert.doesNotMatch(list, /"--preview-summary-h"[^}]*2rem/);

    const shortcuts = readDesktopRoot("uno/shortcuts.preview.ts");
    // Horizontal scroll only on the shared container, not per-line text.
    assert.doesNotMatch(
      shortcuts,
      /"preview-diff-text-nowrap":[^,]*overflow-x-auto/,
    );
    assert.match(shortcuts, /preview-diff-scroll-nowrap|preview-diff-text-nowrap":\s*"whitespace-pre min-w-max/);
    assert.match(shortcuts, /preview-diff-row":[\s\S]*?text-12px/);
    // Sticky file heads stay opaque (surface + opaque hover) — titlebar /
    // white-faint are translucent and let the alignment banner bleed through.
    {
      const fileHead =
        shortcuts.match(/"preview-change-file-head":\s*"([^"]+)"/)?.[1] ?? "";
      assert.match(fileHead, /color-diff-file-head-bg/);
      assert.match(fileHead, /hover:bg-\[var\(--color-diff-file-head-hover\)\]/);
      assert.doesNotMatch(fileHead, /hover:bg-white-/);
      assert.doesNotMatch(fileHead, /titlebar/);
      const summary =
        shortcuts.match(/"preview-change-summary":\s*"([^"]+)"/)?.[1] ?? "";
      assert.doesNotMatch(summary, /h-\[var\(--preview-summary-h/);
      assert.match(summary, /flex-wrap/);
      const label =
        shortcuts.match(
          /"preview-change-summary-label":\s*"([^"]+)"/,
        )?.[1] ?? "";
      assert.match(label, /whitespace-nowrap/);
      assert.doesNotMatch(label, /min-w-0 flex-1/);
      // Icons first (container query @ 22rem), wrap only below the icon row.
      const actions =
        shortcuts.match(
          /"preview-change-summary-actions":\s*"([^"]+)"/,
        )?.[1] ?? "";
      assert.match(actions, /@container/);
      assert.match(actions, /min-w-28/);
      assert.match(actions, /basis-28/);
      assert.match(actions, /flex-nowrap/);
      assert.doesNotMatch(actions, /flex-wrap/);
      assert.doesNotMatch(actions, /flex-1/);
      const actionLabel =
        shortcuts.match(
          /"preview-change-summary-action-label":\s*"([^"]+)"/,
        )?.[1] ?? "";
      assert.match(actionLabel, /@\[22rem\]:inline/);
      const actionIcon =
        shortcuts.match(
          /"preview-change-summary-action-icon":\s*"([^"]+)"/,
        )?.[1] ?? "";
      assert.match(actionIcon, /@\[22rem\]:hidden/);
    }
    const colors = readSrc("styles/defineColor.css");
    assert.match(
      colors,
      /--color-diff-file-head-bg:\s*var\(--color-bg-surface\)/,
    );
    assert.match(colors, /--color-diff-file-head-hover:/);
    assert.doesNotMatch(
      colors,
      /--color-diff-file-head-bg:\s*var\(--color-bg-titlebar\)/,
    );
  });

  it("preview entry points: mention file tokens and tool locations open preview", () => {
    const mention = readSrc("widgets/shared/stateless/MentionTextView.tsx");
    assert.match(mention, /openPreview/);
    assert.match(mention, /kind:\s*"file"/);
    assert.match(mention, /composer-mention-file-btn|type="button"/);
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    assert.match(tool, /openPreview\(\{\s*kind:\s*"file"/);
    assert.doesNotMatch(tool, /window\.open/);
    const turn = readSrc("widgets/timeline/TurnBlockWidget.tsx");
    assert.match(turn, /TurnChangeSummaryView/);
    assert.match(turn, /kind:\s*"changeset"/);
    assert.match(turn, /toolCallIds:\s*collectToolCallIdsFromTurn/);
    const store = readSrc("store/previewStore.ts");
    assert.match(store, /openPreview|closePreview|PreviewTarget/);
  });

  it("doc preview: file orchestrator, doc typography, no agent math (refactor-doc-preview)", () => {
    // File branch goes through PreviewFileWidget, not hard-wired code-only.
    const drawer = readSrc("widgets/preview/PreviewDrawerWidget.tsx");
    assert.match(drawer, /PreviewFileWidget/);
    assert.doesNotMatch(drawer, /PreviewCodeWidget/);
    assert.match(drawer, /onFileToolbarChange|onToolbarChange|fileToolbar/);

    const fileWidget = readSrc("widgets/preview/PreviewFileWidget.tsx");
    assert.match(fileWidget, /previewFileKind/);
    assert.match(fileWidget, /loadDocViewPrefs|saveDocViewPrefs|docViewPrefs/);
    assert.match(fileWidget, /PreviewDocWidget/);
    assert.match(fileWidget, /PreviewCodeWidget/);
    assert.match(fileWidget, /DOC_RENDER_MAX_CHARS|focusLine/);

    const docWidget = readSrc("widgets/preview/PreviewDocWidget.tsx");
    const docComponents = readSrc("widgets/preview/previewDocComponents.tsx");
    // Link matrix + fence highlight live in the component map module.
    assert.match(docComponents, /openExternalUrl/);
    assert.match(docComponents, /sanitizeExternalUrl/);
    assert.match(docComponents, /MarkdownCodeWidget/);
    // Must not import or call the agent math rewrite (timeline-only).
    assert.doesNotMatch(docWidget, /normalizeAgentMath/);
    assert.doesNotMatch(docComponents, /normalizeAgentMath/);
    assert.doesNotMatch(
      docWidget + docComponents,
      /from\s+["']@\/lib\/normalizeAgentMath["']/,
    );
    assert.match(docWidget, /mode="static"/);
    assert.match(docWidget, /parseIncompleteMarkdown=\{false\}/);
    assert.match(docWidget, /docComponents|previewDocComponents/);
    // Relative workspace links must not go through default rehype-harden only.
    assert.match(docWidget, /docRehypePlugins|docRehypeSafety/);
    assert.match(docWidget, /urlTransform/);

    const docView = readSrc("widgets/preview/PreviewDocView.tsx");
    // Literal `group` — Uno shortcuts never emit a real .group class.
    assert.match(docComponents, /doc-pre-wrap group/);
    assert.doesNotMatch(docView, /useSessionStore|usePreviewStore/);
    assert.match(docView, /doc-root|doc-scroll/);

    const head = readSrc("widgets/preview/PreviewHeadView.tsx");
    assert.match(head, /actions\?:/);
    assert.match(head, /preview-head-actions/);

    const toolbar = readSrc("widgets/preview/PreviewFileToolbarView.tsx");
    // Copy click must flash the shared check + "Copied" mark — not tooltip-only.
    assert.match(toolbar, /CopiedMarkView/);
    assert.match(toolbar, /preview-copy-btn/);
    assert.doesNotMatch(toolbar, /className=\{?cs\("btn-ghost|className="btn-ghost/);
    const mark = readSrc("widgets/preview/CopiedMarkView.tsx");
    assert.match(mark, /<span>Copied<\/span>/);
    const flash = readSrc("widgets/preview/CopiedCursorFlashView.tsx");
    assert.match(flash, /createPortal/);
    assert.match(flash, /preview-copy-flash/);
    // Transparent copy-button chrome stacked on the chip lets the path bleed.
    assert.doesNotMatch(flash, /preview-copy-btn/);

    const shortcuts = readAllUnoShortcuts();
    const flashFace = shortcuts.match(/"preview-copy-flash":\s*"([^"]*)"/);
    assert.ok(flashFace?.[1], "preview-copy-flash shortcut present");
    assert.match(flashFace[1], /bg-highest/);
    assert.doesNotMatch(flashFace[1], /bg-transparent|bg-titlebar|bg-white-/);
    // doc-hr must be a visible rule — never copy md-hr's hidden token.
    assert.match(shortcuts, /"doc-hr":/);
    const docHrMatch = shortcuts.match(/"doc-hr":\s*"([^"]*)"/);
    assert.ok(docHrMatch, "doc-hr shortcut must exist");
    assert.doesNotMatch(docHrMatch[1]!, /\bhidden\b/);
    // Absolute body size token + sans root (not mono source chrome).
    assert.match(shortcuts, /text-doc-body|doc-body/);
    const docRootMatch = shortcuts.match(/"doc-root":\s*"([^"]*)"/);
    assert.ok(docRootMatch, "doc-root shortcut must exist");
    assert.doesNotMatch(docRootMatch[1]!, /font-mono/);
    // Aggregation must include the new doc slice + the pre-existing code slice.
    const entry = readDesktopRoot("uno/shortcuts.ts");
    assert.match(entry, /docShortcuts|shortcuts\.doc/);
    assert.match(entry, /codeShortcuts|shortcuts\.code/);
  });

  it("styles use defineColor tokens + UnoCSS (no layout css modules)", () => {
    const css = readSrc("styles/defineColor.css");
    assert.match(css, /--color-bg-app/);
    assert.match(css, /--color-primary/);
    assert.equal(srcExists("styles/base.css"), true);
    assert.equal(srcExists("styles/side-nav.css"), false);
    assert.equal(srcExists("styles/timeline.css"), false);
    assert.equal(srcExists("styles/composer.css"), false);
    assert.equal(srcExists("styles/shell-layout.css"), false);
    assert.equal(srcExists("styles/chrome.css"), false);

    const main = readSrc("main.tsx");
    assert.match(main, /virtual:uno\.css/);
    assert.match(main, /defineColor\.css/);
    assert.match(main, /base\.css/);
    assert.match(main, /base\.react-bits\.css/);

    const uno = readDesktopRoot("uno.config.ts");
    assert.match(uno, /presetUno/);
    assert.match(uno, /configDeps/);
    assert.match(uno, /uno\/shortcuts/);
    assert.match(uno, /var\(--color-bg-app\)/);
    assert.doesNotMatch(uno, /text-white|bg-black|border-red-500/);

    const shortcuts = readAllUnoShortcuts();
    const entry = readDesktopRoot("uno/shortcuts.ts");
    const sideNav = readDesktopRoot("uno/shortcuts.sidenav.ts");
    assert.match(sideNav, /side-nav/);
    assert.match(entry, /sideNavShortcuts|shortcuts\.sidenav/);
    assert.match(entry, /composerShortcuts|shortcuts\.composer/);
    assert.match(shortcuts, /composer-dock/);
    assert.match(shortcuts, /context-drawer/);

    const base = readSrc("styles/base.css");
    assert.equal(
      /#[0-9a-fA-F]{3,8}\b/.test(base),
      false,
      "base.css must not contain hex colors",
    );
  });

  it("dark elevate ladder, semantic surfaces, md fills, and syntax chroma (refactor-color-system)", () => {
    // Drive real shipped tokens in defineColor.css — not a reimplemented ladder.
    const css = readSrc("styles/defineColor.css");
    // Isolate the dark :root block (ends at light theme override).
    const rootStart = css.indexOf(":root {");
    const lightStart = css.indexOf('html[data-theme="light"]');
    assert.ok(rootStart >= 0, "dark :root block present");
    assert.ok(lightStart > rootStart, "light theme block follows :root");
    const darkRoot = css.slice(rootStart, lightStart);
    const lightBlock = css.slice(lightStart);

    // Phase 1 — elevate knobs (dark only).
    assert.match(darkRoot, /--scheme-elevate:\s*4%;/);
    assert.match(darkRoot, /--scheme-elevate-2:\s*11%;/);
    assert.match(darkRoot, /--scheme-elevate-3:\s*16%;/);
    assert.match(darkRoot, /--scheme-elevate-4:\s*22%;/);
    assert.match(darkRoot, /--scheme-elevate-5:\s*28%;/);
    // Phase 3 — text scheme alphas.
    assert.match(darkRoot, /--scheme-secondary:\s*76%;/);
    assert.match(darkRoot, /--scheme-muted:\s*62%;/);
    assert.match(darkRoot, /--scheme-faint:\s*50%;/);
    // Phase 2 — object roles vs flat sidebar.
    assert.match(darkRoot, /--color-bg-elevated:\s*var\(--color-surface-high\);/);
    assert.match(darkRoot, /--color-bg-user:\s*var\(--color-surface-high\);/);
    assert.match(
      darkRoot,
      /--color-bg-composer:\s*var\(--color-surface-container\);/,
    );
    assert.match(
      darkRoot,
      /--color-bg-composer-queue:\s*var\(--color-surface-highest\);/,
    );
    assert.match(
      darkRoot,
      /--color-border-composer-queue:\s*var\(--color-border-muted\);/,
    );
    assert.match(
      darkRoot,
      /--color-bg-sidebar:\s*var\(--color-surface-lowest\);/,
    );
    // Soft fills for md scale.
    assert.match(
      darkRoot,
      /--color-bg-white-code:\s*color-mix\(in oklch,\s*var\(--seed-ink\)\s*5%/,
    );
    assert.match(
      darkRoot,
      /--color-bg-white-chip:\s*color-mix\(in oklch,\s*var\(--seed-ink\)\s*9%/,
    );
    // Phase 5 — desaturated syntax + mention (hue kept, C ~×0.60).
    assert.match(darkRoot, /--color-code-keyword:\s*#7ca4c6;/i);
    assert.match(darkRoot, /--color-code-control:\s*#c09abd;/i);
    assert.match(darkRoot, /--color-code-type:\s*#8acaba;/i);
    assert.match(darkRoot, /--color-code-tag:\s*#7ca4c6;/i);
    assert.match(darkRoot, /--color-code-string:\s*#c7a192;/i);
    assert.match(darkRoot, /--color-code-string-expression:\s*#c7a192;/i);
    assert.match(darkRoot, /--color-code-comment:\s*#89a67e;/i);
    assert.match(darkRoot, /--color-code-constant:\s*#8bc7ec;/i);
    assert.match(darkRoot, /--color-code-number:\s*#c5d4bd;/i);
    assert.match(darkRoot, /--color-code-function:\s*#e4e4c7;/i);
    assert.match(darkRoot, /--color-code-variable:\s*#bde2f7;/i);
    assert.match(darkRoot, /--color-code-parameter:\s*#bde2f7;/i);
    assert.match(darkRoot, /--color-code-link:\s*#84a1d1;/i);
    assert.match(darkRoot, /--color-composer-mention:\s*#4d94d4;/i);
    // Pre-desaturate VS Code literals must not remain on the dark ladder.
    assert.doesNotMatch(darkRoot, /--color-code-keyword:\s*#569cd6;/i);
    assert.doesNotMatch(darkRoot, /--color-composer-mention:\s*#1479c9;/i);
    assert.doesNotMatch(darkRoot, /--color-composer-mention:\s*#84b1df;/i);
    // Diff wash alphas untouched (hard cap for AA on dark surfaces).
    assert.match(
      darkRoot,
      /--color-diff-add-bg[\s\S]{0,160}?--seed-diff-add-wash\)\s+10%/,
    );
    assert.match(
      darkRoot,
      /--color-diff-del-bg[\s\S]{0,160}?--seed-diff-del-wash\)\s+9%/,
    );

    // Light theme still zeros elevate and overrides surfaces.
    assert.match(lightBlock, /--scheme-elevate:\s*0%;/);
    assert.match(lightBlock, /--scheme-elevate-2:\s*0%;/);
    assert.match(lightBlock, /--scheme-elevate-3:\s*0%;/);
    assert.match(lightBlock, /--scheme-elevate-4:\s*0%;/);
    assert.match(lightBlock, /--scheme-elevate-5:\s*0%;/);
    assert.match(lightBlock, /--color-bg-elevated:\s*#ffffff;/i);
    assert.match(lightBlock, /--color-bg-composer:\s*#ffffff;/i);
    assert.match(lightBlock, /--color-bg-composer-queue:\s*color-mix/i);
    assert.match(lightBlock, /--color-bg-user:\s*#ffffff;/i);

    // Uno bg aliases for the new soft fills.
    const uno = readDesktopRoot("uno.config.ts");
    assert.match(uno, /"white-code":\s*"var\(--color-bg-white-code\)"/);
    assert.match(uno, /"white-chip":\s*"var\(--color-bg-white-chip\)"/);
    assert.match(uno, /"composer-queue":\s*"var\(--color-bg-composer-queue\)"/);
    assert.match(uno, /"line-queue":\s*"var\(--color-border-composer-queue\)"/);

    // Timeline md fills + table chrome (one signal: fill/line, no outer box).
    const shortcuts = readAllUnoShortcuts();
    const mdPre = shortcuts.match(/"md-pre":\s*"([^"]+)"/)?.[1] ?? "";
    const mdInline = shortcuts.match(/"md-inline-code":\s*"([^"]+)"/)?.[1] ?? "";
    const mdThead = shortcuts.match(/"md-thead":\s*"([^"]+)"/)?.[1] ?? "";
    const mdTableWrap =
      shortcuts.match(/"md-table-wrap":\s*"([^"]+)"/)?.[1] ?? "";
    const timeline =
      shortcuts.match(/timeline:\s*\n\s*"([^"]+)"/)?.[1] ??
      shortcuts.match(/"timeline":\s*"([^"]+)"/)?.[1] ??
      "";
    assert.match(mdPre, /\bbg-white-code\b/);
    assert.match(mdPre, /\bcode-wrap\b/);
    assert.match(mdPre, /overflow-x-hidden/);
    assert.match(timeline, /\bmin-w-0\b/);
    assert.match(timeline, /overflow-x-hidden/);
    assert.match(timeline, /\bbg-timeline\b/);
    const turnStatus =
      shortcuts.match(/"turn-status":\s*"([^"]+)"/)?.[1] ?? "";
    // Opaque canvas fill outside the transcript scroller: inherit used to
    // compute transparent and let the streaming answer punch through.
    assert.match(turnStatus, /\bbg-timeline\b/);
    assert.match(turnStatus, /\bz-10\b/);
    assert.match(turnStatus, /\bisolate\b/);
    assert.doesNotMatch(turnStatus, /\bbg-inherit\b/);
    assert.doesNotMatch(turnStatus, /\bsticky\b/);
    // Command line + @ / / menu must stack above the Thinking strip.
    const composerCard =
      shortcuts.match(/\n\s+composer:\s*\n\s+"([^"]+)"/)?.[1] ?? "";
    const composerSuggestions =
      shortcuts.match(/"composer-suggestions":\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(composerCard, /\bz-30\b/);
    assert.match(composerSuggestions, /\bz-30\b/);
    assert.match(mdInline, /\bbg-white-chip\b/);
    assert.match(mdThead, /\bbg-white-soft\b/);
    assert.match(mdThead, /border-b\b/);
    assert.match(mdThead, /border-line-subtle/);
    assert.doesNotMatch(mdTableWrap, /\bborder\b/);
    assert.doesNotMatch(mdTableWrap, /border-line-muted/);
  });

  it("mention chips are one shared model across composer, history, and menu", () => {
    const composerInput = readSrc("widgets/composer/ComposerInputView.tsx");
    const timeline = readSrc("widgets/timeline/TimelineView.tsx");
    const userMsg = readSrc("widgets/timeline/UserMessageView.tsx");
    assert.match(composerInput, /from "@\/lib\/mentionTokens"/);
    assert.match(composerInput, /splitMentionTokens/);
    // History mention chips live on UserMessageView (text half of user turns).
    assert.match(timeline, /UserMessageView/);
    assert.match(userMsg, /MentionTextView/);
    assert.match(userMsg, /from "@\/widgets\/shared"/);
    assert.equal(
      srcExists("widgets/composer/composerMentions.ts"),
      false,
      "composer-local mention parser must not come back as a second source of truth",
    );

    const icon = readSrc("widgets/shared/stateless/MentionIconView.tsx");
    assert.match(icon, /from "lucide-react"/);
    const chip = readSrc("widgets/shared/stateless/MentionChipView.tsx");
    const menu = readSrc("widgets/composer/ComposerSuggestionListView.tsx");
    assert.match(chip, /MentionIconView/);
    assert.match(menu, /MentionIconView/);
    assert.doesNotMatch(chip, /<svg/);
    assert.doesNotMatch(timeline, /<svg/);
    assert.doesNotMatch(userMsg, /<svg/);

    const base = readSrc("styles/base.css");
    assert.match(base, /\.mention-chip\b/);
    // Draft + history share unscoped .composer-mention (textarea accent style).
    assert.match(base, /^\.composer-mention\s*\{/m);
    const mentionText = readSrc("widgets/shared/stateless/MentionTextView.tsx");
    assert.match(
      mentionText,
      /composer-mention/,
      "history mentions must use the same accent class as the composer mirror",
    );
    assert.doesNotMatch(
      mentionText,
      /MentionChipView/,
      "history must not use icon-pill chips (keep draft and bubble consistent)",
    );
    // Slice from the real rule (line-start `.composer-mention {`), not a comment.
    const mentionStart = base.search(/^\.composer-mention\s*\{/m);
    const mentionEnd = base.search(/^\.mention-chip\s*\{/m);
    assert.ok(mentionStart >= 0, "composer-mention accent rule must exist");
    assert.ok(mentionEnd > mentionStart, "mention-chip rule must follow accent rules");
    const mentionBlock = base.slice(mentionStart, mentionEnd);
    assert.doesNotMatch(
      mentionBlock,
      /^\s*(padding|margin|font-weight|letter-spacing|font-family)\s*:/m,
      "accent mention tokens must not change glyph metrics (caret alignment)",
    );
    assert.match(
      mentionBlock,
      /--color-composer-mention/,
      "composer + history mentions use the dedicated accent token",
    );
    assert.doesNotMatch(
      mentionBlock,
      /background-color:\s*var\(--color-mention-/,
      "accent mentions must not keep chip fill backgrounds",
    );

    const colors = readSrc("styles/defineColor.css");
    assert.match(colors, /--color-composer-mention/);
    assert.match(colors, /--color-mention-file-border/);
    assert.match(colors, /--color-mention-command-icon/);
    assert.match(colors, /--color-mention-trigger/);
  });

  it("only menu-committed mentions paint, and their marks reach the agent as @", () => {
    const composerInput = readSrc("widgets/composer/ComposerInputView.tsx");
    assert.match(
      composerInput,
      /!seg\.committed/,
      "a typed @path that locked onto nothing must render as plain text",
    );

    const completion = readSrc("widgets/composer/useComposerCompletion.ts");
    assert.doesNotMatch(
      completion,
      /sealCompletedMentions/,
      "typing must not promote text to a committed mention — only the menu can",
    );

    // Zero-width marks are a rendering trick; grok-build only parses `@` / `/`,
    // so every path out of the composer has to materialize them before send.
    const attachments = readSrc("widgets/composer/useComposerAttachments.ts");
    const widget = readSrc("widgets/composer/useComposerWidget.ts");
    const submit = readSrc("widgets/composer/composerSubmit.ts");
    assert.match(attachments, /prepareMentionSend\(args\.draft\)/);
    assert.match(attachments, /assembleMentionBlocks/);
    assert.match(attachments, /buildOutgoingBlocks = useCallback\(async/);
    assert.match(submit, /materializeMentionTriggers/);
    assert.match(submit, /buildOutgoingBlocks/);
    assert.match(widget, /runComposerSubmit/);
    assert.match(widget, /readWorkspaceFile: bridgeReadWorkspaceFile/);

    // Without an explicit cwd the bridge indexes whichever session it started
    // last, so the menu can offer files from a workspace you are not viewing.
    assert.match(widget, /bridgeListWorkspaceEntries\(query, workspace/);
    assert.match(
      readSrc("bridge/liveBridgeFs.ts"),
      /"list_workspace_entries",\s*requestId,\s*query,\s*cwd/,
    );
    assert.match(
      readSrc("bridge/liveBridgeFs.ts"),
      /type:\s*"read_workspace_file"/,
    );

    // gitignored secondary badge only when ignored === true (never filters).
    const menu = readSrc("widgets/composer/ComposerSuggestionListView.tsx");
    assert.match(menu, /gitignored/);
    assert.match(menu, /suggestion\.ignored === true/);
    assert.match(
      readSrc("widgets/composer/composerCompletion.ts"),
      /ignored:\s*entry\.ignored === true/,
    );
    // Pointer must move activeIndex — CSS hover alone leaves Enter on the
    // keyboard row, so the highlight looks stuck on the first option.
    assert.match(menu, /onHighlight:\s*\(index: number\) => void/);
    assert.match(menu, /onMouseEnter=\{\(\) => onHighlight\(index\)\}/);
    assert.match(menu, /onMouseMove=\{\(\) => onHighlight\(index\)\}/);
    assert.match(
      readSrc("widgets/composer/ComposerWidget.tsx"),
      /onHighlight=\{widget\.highlightSuggestion\}/,
    );
    assert.match(
      readSrc("widgets/composer/useComposerCompletion.ts"),
      /const highlightSuggestion = \(index: number\) =>/,
    );
    // ArrowUp/Down must keep the active row inside max-h-80; only the list
    // scrollTop moves so the timeline / page do not jump with the highlight.
    assert.match(
      menu,
      /ref=\{index === activeIndex \? revealActiveSuggestion : undefined\}/,
    );
    const scroll = readSrc("widgets/composer/composerSuggestionScroll.ts");
    assert.match(scroll, /export function revealActiveSuggestion/);
    assert.match(scroll, /export function scrollTopToRevealItem/);
    assert.match(scroll, /port\.scrollTop = next/);
    assert.match(scroll, /el\.closest\("#composer-suggestions"\)/);
  });

  it("shell keyboard maps ⌘N ⌘, ⌘\\ and drawers have dual reachability", () => {
    const events = readSrc("widgets/shell/useShellChromeEvents.ts");
    assert.match(events, /key\.toLowerCase\(\) === "n"/);
    assert.match(events, /setPaletteOpen\(false\)/);
    assert.match(events, /key === ",/);
    assert.match(events, /Backslash|\\\\/);
    // Workspace menu dispatches open-panel / open-environment (Settings / Overview / Environment).
    // Tasks is session-scoped and lives on the context rail (Agents tab).
    const workspaceMenuWidget = readSrc(
      "widgets/SessionRailWorkspaceMenuWidget.tsx",
    );
    assert.match(workspaceMenuWidget, /open-panel|open-environment/);
    assert.match(workspaceMenuWidget, /settings/);
    assert.doesNotMatch(workspaceMenuWidget, /"tasks"/);
    assert.match(workspaceMenuWidget, /overview/);
    assert.match(workspaceMenuWidget, /environment/);
    assert.doesNotMatch(workspaceMenuWidget, /"extensions"/);
    const palette = readSrc("lib/commandPalette.ts");
    assert.match(
      palette,
      /open_settings|open_environment|open_overview|open_agents/,
    );
    assert.match(palette, /open_env_mcp|open_env_skills/);
    assert.match(palette, /export function openEnvironment/);
    assert.doesNotMatch(palette, /open_extensions/);
    assert.doesNotMatch(palette, /open_tasks/);
    // Environment chrome shortcuts + D5 regression (no example.com MCP writer).
    const chrome = readAllUnoShortcuts();
    assert.match(chrome, /"env-sheet":/);
    assert.match(chrome, /"env-row":/);
    assert.match(chrome, /"env-status-dot":/);
    assert.match(readSrc("widgets/shell/shellPanels.ts"), /"environment"/);
    assert.doesNotMatch(
      readSrc("widgets/shell/shellPanels.ts"),
      /"extensions"/,
    );
    // No JSON.stringify dumps under environment widgets; no example-http writer in src.
    const envDir = join(SRC_ROOT, "widgets/environment");
    for (const name of readdirSync(envDir)) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) {
        continue;
      }
      const text = readFileSync(join(envDir, name), "utf8");
      assert.doesNotMatch(
        text,
        /JSON\.stringify/,
        `${name} must not dump JSON`,
      );
    }
    // Walk desktop src for D5 / hooks_trust regressions (product source only).
    const srcHits: string[] = [];
    const stack = [SRC_ROOT];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(ent.name)) {
          continue;
        }
        const text = readFileSync(p, "utf8");
        if (
          /example-http|example\.com/.test(text) ||
          text.includes("hooks_trust") ||
          text.includes("ExtensionsPanelWidget")
        ) {
          srcHits.push(p.slice(SRC_ROOT.length + 1));
        }
      }
    }
    assert.deepEqual(
      srcHits,
      [],
      `unexpected D5/extensions remnants: ${srcHits.join(", ")}`,
    );
  });

  it("U-09..11: Rules & prompts page is real three-scope editor (not stub)", () => {
    const page = readSrc("widgets/prompts/PromptsPageWidget.tsx");
    const body = readSrc("widgets/prompts/PromptsPageBodyView.tsx");
    const section = readSrc("widgets/prompts/PromptScopeSectionView.tsx");
    const row = readSrc("widgets/prompts/PromptEntryRowView.tsx");
    const evidence = readSrc("widgets/prompts/PromptEvidenceBarView.tsx");
    const hook = readSrc("widgets/prompts/usePromptsWidget.ts");
    const sheet = readSrc("widgets/environment/EnvironmentSheetWidget.tsx");
    const envHook = readSrc("widgets/environment/useEnvironmentWidget.ts");

    // U-09: page uses hook; views do not own store hooks.
    assert.match(page, /usePromptsWidget/);
    assert.doesNotMatch(section, /useSessionStore|useUserPromptsStore/);
    assert.doesNotMatch(row, /useSessionStore|useUserPromptsStore/);
    assert.doesNotMatch(evidence, /useSessionStore|useUserPromptsStore/);
    assert.doesNotMatch(body, /useSessionStore|useUserPromptsStore/);
    assert.match(hook, /useUserPromptsStore/);

    // U-10: real paths + token label; rules case is not stub.
    assert.match(section, /pathLabel|prompt-scope-path/);
    assert.match(section, /tokenLabel|prompt-scope-tok/);
    assert.match(sheet, /PromptsPageWidget/);
    assert.doesNotMatch(
      sheet,
      /case "rules":\s*return\s*\(\s*<EnvironmentStubPageView/,
    );
    assert.match(envHook, /Rules & prompts/);
    // rules nav item must not set soon:true (compat after it still may).
    assert.match(
      envHook,
      /id:\s*"rules",\s*\n\s*label:\s*"Rules & prompts",\s*\n\s*count:[^\n]+,\s*\n\s*\},/,
    );
    assert.doesNotMatch(
      envHook,
      /id:\s*"rules",\s*\n\s*label:\s*"Rules & prompts",\s*\n\s*count:[^\n]+,\s*\n\s*soon:\s*true/,
    );

    // U-11: no tablist for scopes — stacked sections only.
    assert.doesNotMatch(body, /role=["']tablist["']/);
    assert.doesNotMatch(section, /role=["']tablist["']/);
    assert.doesNotMatch(page, /role=["']tablist["']/);
    assert.match(body, /prompt-overlay-hint|下面的覆盖上面的/);
  });
});

/*
 * Generated-CSS guard for the whole transform family, not one call site.
 *
 * presetUno's translate/scale/rotate/skew utilities set a --un-* custom
 * property and then emit one composed
 * `transform: translateX(var(--un-translate-x)) … scaleZ(var(--un-scale-z))`.
 * Those vars exist only in the preflight this app disables (uno.config:
 * `presetUno({ preflight: false })`), so the declaration is invalid at
 * computed-value time and the browser resolves `transform: none` — the class
 * looks applied in devtools and moves nothing. `-`-prefixed spellings are
 * worse: presetMini's negative variant strips the dash, matches the plain
 * rule, finds nothing numeric to negate and drops the body, emitting no CSS
 * at all. Anything that must actually move needs a plain rule in uno.config.
 */
describe("UnoCSS transform utilities emit literal values", () => {
  it("no shortcut emits a --un-* transform chain or an empty body", async () => {
    const uno = await createGenerator(unoConfigModule);
    const varChains: string[] = [];
    const empty: string[] = [];
    for (const [name, body] of Object.entries(appShortcuts)) {
      const { css } = await uno.generate(name, { preflights: false });
      for (const [, value] of css.matchAll(/transform:\s*([^;}]+)/g)) {
        if (value.includes("var(--un-")) {
          varChains.push(`${name}: ${value}`);
        }
      }
      // A transform-only shortcut that generates nothing is the dashed-key trap.
      const transformOnly = /^-?(translate|scale|rotate|skew)-\S+$/.test(
        body.trim(),
      );
      if (transformOnly && !css.includes("transform:")) {
        empty.push(`${name}: "${body}" generated no transform`);
      }
    }
    assert.deepEqual(varChains, []);
    assert.deepEqual(empty, []);
  });

  it("rail folder and session titles use nav line-height (descenders fit)", async () => {
    const uno = await createGenerator(unoConfigModule);
    const { css } = await uno.generate(
      "project-group-name project-group-header project-group-main loose-group-header sess-title sess-row",
      { preflights: false },
    );
    assert.match(
      css,
      /\.project-group-name\{[^}]*line-height:var\(--line-height-nav-item\)/,
    );
    assert.match(
      css,
      /\.sess-title\{[^}]*line-height:var\(--line-height-nav-item\)/,
    );
    assert.doesNotMatch(
      css,
      /\.project-group-name\{[^}]*line-height:(?:1(?:\.375)?|15\.6px)/,
    );
    // Emitted box must be 36px, not rem 2em/h-8. "grok-desktop" was clipped
    // when the folder row collapsed to 26px under html { font-size: 13px }.
    // Uno may group .loose-group-header + .project-group-header (same body).
    assert.match(css, /\.project-group-header[^{]*\{[^}]*min-height:36px/);
    assert.match(css, /\.loose-group-header[^{]*\{[^}]*min-height:36px/);
    assert.match(css, /\.project-group-main\{[^}]*height:36px/);
    assert.match(css, /\.sess-row\{[^}]*height:36px/);
    assert.match(css, /\.project-group-name\{[^}]*overflow-x:hidden/);
    assert.match(css, /\.sess-title\{[^}]*overflow-x:hidden/);
    assert.doesNotMatch(
      css,
      /\.project-group-name\{[^}]*overflow:hidden/,
    );
    assert.doesNotMatch(css, /\.sess-title\{[^}]*overflow:hidden/);
  });

  it("rail folder count badge is an 18px box with matching line-height", async () => {
    const uno = await createGenerator(unoConfigModule);
    const { css } = await uno.generate(
      "project-group-count side-nav-nav-badge",
      { preflights: false },
    );
    assert.match(css, /\.project-group-count\{[^}]*height:18px/);
    assert.match(css, /\.project-group-count\{[^}]*min-width:18px/);
    assert.match(css, /\.project-group-count\{[^}]*line-height:18px/);
    assert.match(css, /\.project-group-count\{[^}]*font-size:10px/);
    assert.doesNotMatch(
      css,
      /\.project-group-count\{[^}]*height:1\.125rem/,
    );
    assert.match(css, /\.side-nav-nav-badge\{[^}]*height:18px/);
    assert.match(css, /\.side-nav-nav-badge\{[^}]*line-height:18px/);
  });

  it("named shortcuts that used to warn emit real CSS", async () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const uno = await createGenerator(unoConfigModule);
      const { css } = await uno.generate(
        [
          "main-body",
          "preview-head",
          "preview-diff-row",
          "doc-pre-wrap",
          "prompt-badge-overridden",
          "turn-status",
        ].join(" "),
        { preflights: false },
      );
      assert.match(css, /\.main-body\{[^}]*transition-property:padding-right/);
      assert.match(css, /\.preview-head\{[^}]*min-height:var\(--topnav-height\)/);
      assert.match(css, /\.turn-status\{[^}]*--un-shadow:/);
      assert.match(
        css,
        /\.turn-status\{[^}]*background-color:var\(--color-bg-timeline\)/,
      );
      assert.match(css, /\.turn-status\{[^}]*z-index:10/);
      assert.match(css, /\.turn-status\{[^}]*isolation:isolate/);
      assert.match(css, /\.prompt-badge-overridden\{[^}]*text-decoration:none/);
      assert.doesNotMatch(css, /unmatched/);
    } finally {
      console.warn = orig;
    }
    assert.deepEqual(
      warnings.filter((w) => w.includes("unmatched utility")),
      [],
    );
  });

  it("side-nav offcanvas slides in on data-open via own-width transforms", async () => {
    const uno = await createGenerator(unoConfigModule);
    const { css } = await uno.generate("side-nav-offcanvas", {
      preflights: false,
    });
    // Closed: pushed a full own-width left. Open: back to 0, via the
    // higher-specificity attribute selector (wins on specificity, not order).
    assert.match(
      css,
      /\.side-nav-offcanvas\{[^}]*transform:translateX\(-100%\)/,
    );
    assert.match(
      css,
      /\.side-nav-offcanvas\[data-open=true\]\{transform:translateX\(0\)/,
    );
  });
});

/**
 * Strip comments so a mention in a doc comment is not treated as a call.
 * @param src TypeScript / TSX source.
 */
function stripSourceComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Collect .ts/.tsx files under a src-relative directory.
 * @param rel Directory relative to apps/desktop/src.
 */
function listSrcFiles(rel: string): string[] {
  const dir = join(SRC_ROOT, rel);
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(abs);
    }
  }
  return out;
}

describe("Agents inspect never navigates the main canvas", () => {
  it("agents panel and timeline never invoke selectSession", () => {
    const files = [
      ...listSrcFiles("widgets/agentsRail"),
      ...listSrcFiles("widgets/timeline"),
    ];
    for (const file of files) {
      const stripped = stripSourceComments(readFileSync(file, "utf8"));
      assert.doesNotMatch(
        stripped,
        /\bselectSession\b/,
        `${file} must not invoke selectSession`,
      );
    }
  });

  it("only one production timeline model implementation exists", () => {
    const widgetHook = readSrc("widgets/timeline/useTimelineWidget.ts");
    const model = readSrc("widgets/timeline/useTimelineModel.ts");
    const canvas = readSrc("widgets/timeline/TimelineWidget.tsx");
    assert.match(widgetHook, /useTimelineModel/);
    assert.doesNotMatch(stripSourceComments(widgetHook), /buildTimelineRenderUnits/);
    assert.match(model, /buildTimelineRenderUnits/);
    assert.match(canvas, /useTimelineWidget/);
    assert.doesNotMatch(stripSourceComments(canvas), /useTimelineModel/);
    const widgetDir = join(SRC_ROOT, "widgets");
    const callers: string[] = [];
    const stack = [widgetDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (!dir) {
        continue;
      }
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, name.name);
        if (name.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!name.name.endsWith(".ts") && !name.name.endsWith(".tsx")) {
          continue;
        }
        const stripped = stripSourceComments(readFileSync(abs, "utf8"));
        if (/\bbuildTimelineRenderUnits\s*\(/.test(stripped)) {
          callers.push(abs.slice(SRC_ROOT.length + 1));
        }
      }
    }
    assert.deepEqual(callers, ["widgets/timeline/useTimelineModel.ts"]);
  });
});
