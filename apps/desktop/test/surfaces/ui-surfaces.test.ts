/**
 * Structural checks: shell chrome IA + live-only product path + UnoCSS setup.
 * Assertions match the slim top-nav / Composer mode / footer drawer IA.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
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
    const plan = readSrc("widgets/PlanPanelView.tsx");
    assert.doesNotMatch(plan, /Approve|plan-approval|sendPrompt|useSessionStore/);
    assert.doesNotMatch(plan, /showApproval|PlanApprovalDock/);
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    // Tool cards are flat surfaces: no pointer-following spotlight under them.
    assert.doesNotMatch(tool, /SpotlightCard/);
    assert.match(tool, /EditSummaryRowView/);
    assert.match(tool, /openPreview/);
    assert.doesNotMatch(tool, /DiffReviewView/);
    const diff = readSrc("widgets/preview/DiffReviewView.tsx");
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
    assert.doesNotMatch(drawer, /type="checkbox"/);
    assert.doesNotMatch(drawer, /showApproval|PlanApprovalDock|sendPrompt/);

    const top = readSrc("widgets/TopNavWidget.tsx");
    assert.match(top, /aria-expanded=\{props\.contextRailOpen\}/);
    assert.match(top, /aria-controls="context-rail"/);
    assert.match(top, /top-nav-railed/);
    assert.doesNotMatch(top, /aria-pressed=\{props\.contextRailOpen\}/);

    const shellHook = readSrc("widgets/shell/useAppShellWidget.ts");
    assert.match(shellHook, /loadContextDrawerPrefs|saveContextDrawerPrefs/);
    assert.match(shellHook, /effectiveDrawerLayout|DRAWER_PUSH_MIN_WIDTH/);
    assert.match(shellHook, /matchMedia/);
    // Plan|Agents share push content so tab switches do not jump main width.
    assert.match(shellHook, /contextRailHasContent/);
    assert.match(shellHook, /agentItemCount/);
    assert.match(shellHook, /backgroundTasks/);
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
    assert.match(prefs, /export function effectiveDrawerLayout/);
    assert.match(prefs, /export function loadContextDrawerPrefs/);
    assert.match(prefs, /export function saveContextDrawerPrefs/);

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
      /"main-body":\s*[\s\S]*?transition-\[padding-right\][\s\S]*?duration-slow/,
    );
    assert.match(
      shellShortcuts,
      /"top-nav":\s*[\s\S]*?transition-\[right\][\s\S]*?duration-slow/,
    );
    assert.doesNotMatch(
      shellShortcuts,
      /"main-body-railed":\s*"[^"]*transition/,
    );

    const uno = readDesktopRoot("uno.config.ts");
    assert.match(uno, /translate-x-rail/);
    assert.match(uno, /translate-x-full/);
    assert.match(uno, /translate-x-none/);
    assert.match(uno, /"right-rail"/);
    assert.match(uno, /"pr-rail"/);

    const colors = readSrc("styles/defineColor.css");
    assert.match(colors, /--rail-right-width:\s*280px/);
    assert.match(colors, /--preview-width-default:\s*560px/);
    assert.match(colors, /--preview-width-min:\s*420px/);
    assert.match(colors, /--preview-width-max:\s*900px/);

    const panels = readSrc("widgets/shell/shellPanels.ts");
    assert.match(panels, /ContextRailId\s*=\s*"plan"\s*\|\s*"preview"/);
    assert.match(panels, /contextRailWidthPx/);
    assert.match(panels, /export function contextRailHasContent/);
    // Shared companion: either Plan or Agents content drives both tabs.
    assert.match(
      panels,
      /rail === "plan" \|\| rail === "agents"[\s\S]*?planCount > 0 \|\| agentItemCount > 0/,
    );

    const previewDrawer = readSrc("widgets/preview/PreviewDrawerWidget.tsx");
    assert.match(previewDrawer, /id="preview-rail"/);
    assert.match(previewDrawer, /preview-resize-handle|setWidth|clampPreviewWidth/);
    assert.match(previewDrawer, /usePreviewSource/);
    // Remount DiffReviewView when switching targets (avoids stale hunk state).
    assert.match(previewDrawer, /key=\{`\$\{source\.toolCallId\}:\$\{source\.path\}`\}/);

    const previewSource = readSrc("widgets/preview/usePreviewSource.ts");
    assert.match(previewSource, /buildTurnChangeSetById/);

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
  });

  it("top-nav shortcuts cover slim chrome only (no mode tabs)", () => {
    const shortcuts = readAllUnoShortcuts();
    const top = readSrc("widgets/TopNavWidget.tsx");
    const menuView = readSrc("widgets/SessionActionsMenuView.tsx");
    const shortcutNames = [
      "top-nav",
      "top-nav-left",
      "top-nav-session-title",
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
      "top-nav-session-title",
      "top-nav-sync",
      "top-nav-right",
      "top-nav-icon-btn",
      "top-nav-context-btn",
    ];
    for (const name of usedInTop) {
      assert.match(top, new RegExp(name), `TopNav should use ${name}`);
    }
    assert.match(menuView, /top-nav-menu/);
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
    const shell = readSrc("widgets/SidePanelShell.tsx");
    const draft = readSrc("lib/settingsDraft.ts");
    const shortcuts = readAllUnoShortcuts();
    assert.match(shell, /footer/);
    assert.match(shortcuts, /"side-panel-footer":/);
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
    assert.match(menu, /buildForkCommand|runSessionMenuAction/);
  });

  it("narrow shell collapses rail off-canvas and keeps top-nav full-bleed", () => {
    const shortcuts = readAllUnoShortcuts();
    const sideNav = readDesktopRoot("uno/shortcuts.sidenav.ts");
    const base = readSrc("styles/base.css");
    // ≤900px: rail overlays so tablet/narrow laptop keep chat width.
    assert.match(shortcuts, /"main-column":[\s\S]*?max-\[900px\]:ml-0/);
    assert.match(shortcuts, /"top-nav":[\s\S]*?max-\[900px\]:left-0/);
    assert.match(shortcuts, /"top-nav-rail-btn":/);
    // Narrow shell lives only in Uno (no duplicate base.css media query).
    assert.doesNotMatch(base, /@media \(max-width:\s*639px\)/);
    assert.match(
      sideNav,
      /"side-nav":[\s\S]*?max-\[900px\]:translate-x-\[-100%\]/,
    );
    assert.match(sideNav, /max-\[900px\]:data-\[open=true\]:translate-x-0/);
    const top = readSrc("widgets/TopNavWidget.tsx");
    assert.match(top, /onToggleRail|top-nav-rail-btn/);
    const rail = readSrc("widgets/sessionRail/SessionRailView.tsx");
    assert.match(rail, /data-open|onClose|railOpen/);
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
    // Only the directory half may be ellipsized — the file name stays whole.
    assert.match(shortcuts, /"path-label-dir":[^"]*"[^"]*text-ellipsis/);
    assert.match(shortcuts, /"path-label-base":[^"]*"[^"]*shrink-0/);
    // Preview drawer head speaks the same path language as the timeline.
    const previewHead = readSrc("widgets/preview/PreviewHeadView.tsx");
    assert.match(previewHead, /PathLabelView/);
    assert.match(previewHead, /data-path=\{display\.full\}/);
    assert.match(previewHead, /onDoubleClick=\{onCopyPath\}/);
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
    assert.doesNotMatch(app, /TasksPanelWidget/);
    assert.match(app, /ContextDrawerWidget/);
    assert.match(app, /buildRewindCommand/);
    const agents = readSrc("widgets/agentsRail/AgentsRailWidget.tsx");
    assert.match(agents, /AgentsRailView/);
    const menu = readSrc("widgets/SessionMenuWidget.tsx");
    assert.match(menu, /buildForkCommand|runSessionMenuAction/);
    const timeline = readSrc("widgets/timeline/TimelineView.tsx");
    const hook = readSrc("widgets/timeline/useTimelineWidget.ts");
    const pipeline = readSrc("lib/timelinePipeline.ts");
    assert.match(pipeline, /buildTimelineRenderUnits/);
    assert.match(hook, /buildTimelineRenderUnits/);
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
    const composer = readSrc("widgets/composer/useComposerWidget.ts");
    assert.match(composer, /grok-desktop:prefill-composer/);
    const diff = readSrc("widgets/preview/DiffReviewView.tsx");
    assert.match(diff, /applyHunkDecisions/);
    assert.match(diff, /writeWorkspaceFile|Accept|Reject/);
    const themeCss = readSrc("styles/defineColor.css");
    assert.match(themeCss, /data-theme="light"/);
    assert.match(themeCss, /--seed-brand/);
    assert.match(themeCss, /color-mix\(in oklch/);
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
    assert.match(appearance, /COLOR_PALETTE_OPTIONS|UI color/);
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
    // Pin is per-session, not per folder.
    assert.match(railHook, /orderGroupsBySessionPin/);
    assert.match(railHook, /toggleCollapsedWorkspace|onToggleCollapse/);
    assert.match(railHook, /loadSessionRailPrefs|saveSessionRailPrefs/);
    assert.match(railHook, /expandWorkspacePreview|onExpandPreview/);
    assert.match(railHook, /togglePinnedSession|onTogglePin/);
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
    {
      const header =
        sideNavShortcuts.match(
          /"project-group-header":\s*"([^"]+)"/,
        )?.[1] ?? "";
      assert.match(header, /hover:bg-sidebar-hover/);
      assert.doesNotMatch(header, /hover:bg-white-/);
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
    assert.match(groupView, /Show .+ more|Show more/);
    assert.match(groupView, /PROJECT_SESSION_PREVIEW/);
    assert.match(groupView, /onToggleCollapse/);
    // Collapse / "Show more" are controlled from rail prefs (not local useState).
    assert.match(groupView, /previewExpanded/);
    assert.match(groupView, /onExpandPreview/);
    assert.doesNotMatch(groupView, /useState/);
    // Title | trailing actions (pin + meta). No leading status dot.
    const sessionRow = readSrc("widgets/SessionRailSessionRowView.tsx");
    assert.match(sessionRow, /sess-actions/);
    assert.match(sessionRow, /sess-meta/);
    assert.doesNotMatch(sessionRow, /sess-status/);
    assert.match(sessionRow, /sess-pin/);
    assert.match(sessionRow, /onTogglePin/);
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
    assert.doesNotMatch(shortcuts, /"sess-status"/);
    assert.match(
      shortcuts,
      /"project-group-name":\s*"min-w-0 flex-1[\s\S]*?text-nav font-medium[\s\S]*?leading-snug/,
    );
    assert.match(shortcuts, /"project-section-label":/);
    assert.match(shortcuts, /"project-group-sessions":/);
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
    // its row scrolls off / the group collapses: idle names sit at secondary
    // ink, active lifts name + folder glyph + tree guide. Parent selectors
    // only — same-element overrides lose on Uno emit order.
    {
      const groupActive =
        shortcuts.match(/"project-group-active":\s*"([^"]+)"/)?.[1] ?? "";
      assert.match(groupActive, /\[&_\.project-group-name\]:text-fg\b/);
      assert.match(groupActive, /\[&_\.project-group-folder\]:/);
      assert.match(
        groupActive,
        /\[&_\.project-group-sessions\]:before:bg-line-/,
      );
      assert.doesNotMatch(groupActive, /bg-white-|bg-sidebar/);
      assert.match(
        shortcuts,
        /"project-group-name":[\s\S]*?text-fg-secondary/,
      );
      assert.match(groupView, /project-group-active/);
      assert.match(railHook, /selectedWorkspace/);
      assert.match(rail, /selectedWorkspace/);
    }
    // Folder count stays visible (no hover-hide); session pin + time/remove own their slots.
    const countShortcut = shortcuts.match(
      /"project-group-count":\s*"([^"]+)"/,
    );
    assert.ok(countShortcut?.[1], "project-group-count shortcut present");
    assert.doesNotMatch(countShortcut[1], /group-hover:opacity-0/);
    assert.match(shortcuts, /"sess-pin":/);
    assert.match(shortcuts, /"sess-pin-active":/);
    // Pinned visibility must win over base `.sess-pin { opacity:0 }` via parent
    // selector — same-element active class alone loses on Uno cascade order.
    assert.match(
      shortcuts,
      /"sess-row-pinned":[\s\S]*?\[&_\.sess-pin\]:\(opacity-100/,
    );
    assert.match(shortcuts, /"sess-time":[\s\S]*?group-hover:opacity-0/);
    assert.match(shortcuts, /"sess-meta":[\s\S]*?w-\[24px\]/);
    // Remove is a narrow right-aligned control, not a full-slot inset fill.
    assert.match(
      shortcuts,
      /"sess-remove":[\s\S]*?absolute right-0[\s\S]*?w-5\.5/,
    );
    assert.doesNotMatch(
      shortcuts.match(/"sess-remove":\s*"([^"]+)"/)?.[1] ?? "",
      /inset-0/,
    );
    // Close control must zero native button padding; ≥28px hit target is centered.
    assert.match(shortcuts, /"sess-remove":[\s\S]*?p-0/);
    assert.match(shortcuts, /"sess-remove":[\s\S]*?justify-center/);
    assert.match(shortcuts, /"sess-pin":[\s\S]*?w-7 h-7/);
  });

  it("tool card normalizes array content and plan empty is en-US", () => {
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    assert.match(tool, /normalizeToolContentParts|summarizeEditContent/);
    // Timeline no longer embeds full interactive review; summary + openPreview only
    assert.match(tool, /EditSummaryRowView/);
    assert.match(tool, /openPreview/);
    // Large tool dumps collapse by default (Show full output).
    assert.match(tool, /Show full output|tool-content-collapsed|shouldCollapseToolText/);
    assert.doesNotMatch(tool, /DiffReviewView/);
    assert.doesNotMatch(tool, /window\.open\(`file:\/\//);
    const diff = readSrc("widgets/preview/DiffReviewView.tsx");
    assert.match(diff, /mini-diff|applyHunkDecisions/);
    const plan = readSrc("widgets/PlanPanelView.tsx");
    assert.match(plan, /No plan yet/);
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
  });

  it("shell keyboard maps ⌘N ⌘, ⌘\\ and drawers have dual reachability", () => {
    const events = readSrc("widgets/shell/useShellChromeEvents.ts");
    assert.match(events, /key\.toLowerCase\(\) === "n"/);
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
});
