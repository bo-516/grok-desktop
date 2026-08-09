/**
 * Structural checks: shell chrome IA + live-only product path + UnoCSS setup.
 * Assertions match the slim top-nav / Composer mode / footer drawer IA.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readDesktopRoot,
  readSrc,
  srcExists,
} from "../helpers/sourceFiles";

describe("UI surface presence", () => {
  it("timeline renders user/agent/thought/tool kinds", () => {
    const timeline = readSrc("widgets/TimelineView.tsx");
    const thought = readSrc("widgets/timeline/ThoughtWidget.tsx");
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    assert.match(timeline, /data-kind="user"/);
    assert.match(timeline, /data-kind="agent"/);
    assert.match(timeline, /StreamingMarkdownView/);
    assert.match(thought, /data-kind="thought"/);
    assert.match(tool, /data-kind="tool"/);
    assert.match(timeline, /toolCalls/);
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
  });

  it("permission UI offers selectable outcomes", () => {
    const src = readSrc("widgets/PermissionModalView.tsx");
    assert.match(src, /respondPermission/);
    assert.match(src, /allow_once/);
    assert.match(src, /deny/);
  });

  it("App shell matches prototype regions", () => {
    const src = readSrc("App.tsx");
    assert.match(src, /SessionRailView/);
    assert.match(src, /TimelineView/);
    assert.match(src, /ComposerWidget/);
    assert.match(src, /TopNavWidget/);
    assert.match(src, /main-column/);
    assert.match(src, /ContextRailWidget/);
    assert.match(src, /ShellBannersView/);
    assert.match(src, /useAppShellWidget/);
    assert.doesNotMatch(src, /Viewing saved history|read-only/);
    const top = readSrc("widgets/TopNavWidget.tsx");
    assert.match(top, /top-nav/);
  });

  it("surfaces command palette, extensions, settings, plan approval, confirm", () => {
    const app = readSrc("App.tsx");
    assert.match(app, /CommandPaletteWidget/);
    assert.match(app, /ExtensionsPanelWidget/);
    assert.match(app, /SettingsPanelWidget/);
    assert.match(app, /ConfirmDialogView/);
    assert.match(app, /buildConfirmPrompt/);
    const shellHook = readSrc("widgets/shell/useAppShellWidget.ts");
    assert.match(shellHook, /activePanel|toggleExclusivePanel|PanelId/);
    const shell = readSrc("widgets/SidePanelShell.tsx");
    assert.match(shell, /side-panel-backdrop/);
    assert.match(shell, /side-panel-close/);
    assert.match(shell, /Escape/);
    const plan = readSrc("widgets/PlanPanelView.tsx");
    assert.match(plan, /Approve|plan-approval/);
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    assert.match(tool, /DiffReviewView|SpotlightCard/);
    const diff = readSrc("widgets/timeline/DiffReviewView.tsx");
    assert.match(diff, /buildLineDiff|mini-diff|applyHunkDecisions/);
  });

  it("Uno shortcuts define side-panel and btn-ghost (no white-out drawers)", () => {
    const shortcuts = readDesktopRoot("uno.shortcuts.ts");
    assert.match(shortcuts, /"side-panel":/);
    assert.match(shortcuts, /bg-elevated/);
    assert.match(shortcuts, /"btn-ghost":/);
    assert.match(shortcuts, /"side-panel-close":/);
    assert.match(shortcuts, /"modal-panel":/);
  });

  it("top-nav shortcuts cover slim chrome only (no mode tabs)", () => {
    const shortcuts = readDesktopRoot("uno.shortcuts.ts");
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
      />(?:Chat|Tasks|Overview|Extensions|Settings)</,
    );
    assert.doesNotMatch(top, /Plan ·/);
    // Composer owns mode chrome
    assert.match(shortcuts, /"composer-mode":/);
    assert.match(shortcuts, /"composer-mode-trigger":/);
    assert.match(shortcuts, /"composer-mode-menu":/);
  });

  it("settings sticky apply, dirty helpers, no ticket ids, tokenized controls", () => {
    const settings = readSrc("widgets/SettingsPanelWidget.tsx");
    const shell = readSrc("widgets/SidePanelShell.tsx");
    const draft = readSrc("lib/settingsDraft.ts");
    const shortcuts = readDesktopRoot("uno.shortcuts.ts");
    assert.match(shell, /footer/);
    assert.match(shortcuts, /"side-panel-footer":/);
    assert.match(settings, /isSettingsDraftDirty|dirty/);
    assert.match(settings, /Discard unsaved|requestClose/);
    assert.doesNotMatch(settings, /J-06/);
    assert.match(settings, /Security|security-sensitive|No sandbox/);
    assert.match(settings, /from "@\/components\/ui\/Checkbox"/);
    assert.match(settings, /from "@\/components\/ui\/Select"/);
    assert.match(draft, /isSettingsDraftDirty|settingsDraftEqual/);
    const checkbox = readSrc("components/ui/Checkbox.tsx");
    assert.match(checkbox, /type="checkbox"/);
    assert.match(checkbox, /ui-check/);
  });

  it("focus-visible tokens and FadeContent reduced-motion / default readable", () => {
    const base = readSrc("styles/base.css");
    const colors = readSrc("styles/defineColor.css");
    const fade = readSrc("components/react-bits/FadeContent.tsx");
    assert.match(colors, /--color-focus-ring/);
    assert.match(base, /:focus-visible/);
    assert.match(base, /prefers-reduced-motion/);
    assert.match(base, /\.rb-fade\s*\{[^}]*opacity:\s*1/s);
    assert.match(fade, /prefersReducedMotion|prefers-reduced-motion/);
    assert.match(fade, /rb-fade-pending/);
  });

  it("top-nav exposes context-rail aria and session menu danger", () => {
    const top = readSrc("widgets/TopNavWidget.tsx");
    assert.match(top, /aria-pressed/);
    assert.match(top, /aria-controls="context-rail"/);
    assert.doesNotMatch(top, /role="tab"/);
    assert.doesNotMatch(top, /aria-selected/);
    const menu = readSrc("widgets/SessionMenuWidget.tsx");
    assert.match(menu, /danger:\s*true/);
    assert.match(menu, /buildForkCommand|runSessionMenuAction/);
  });

  it("narrow shell collapses rail off-canvas and keeps top-nav full-bleed", () => {
    const shortcuts = readDesktopRoot("uno.shortcuts.ts");
    const base = readSrc("styles/base.css");
    assert.match(shortcuts, /"main-column":[\s\S]*?max-sm:ml-0/);
    assert.match(shortcuts, /"top-nav":[\s\S]*?max-sm:left-0/);
    assert.match(shortcuts, /"top-nav-rail-btn":/);
    assert.match(base, /@media \(max-width:\s*639px\)/);
    assert.match(base, /\.side-nav[\s\S]*?translateX\(-100%\)/);
    assert.match(base, /\.side-nav\[data-open="true"\]/);
    const top = readSrc("widgets/TopNavWidget.tsx");
    assert.match(top, /onToggleRail|top-nav-rail-btn/);
    const rail = readSrc("widgets/SessionRailView.tsx");
    assert.match(rail, /data-open|onClose/);
    assert.match(
      shortcuts,
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
    const shortcuts = readDesktopRoot("uno.shortcuts.ts");
    assert.match(shortcuts, /"tool-loc-link":/);
    assert.match(shortcuts, /"tool-locations":/);
    assert.match(shortcuts, /"tool-group-toggle":/);
    assert.match(shortcuts, /"badge-ok":/);
    const base = readSrc("styles/base.css");
    assert.match(base, /button\s*\{[^}]*background-color:\s*transparent/s);
  });

  it("React Bits adaptations ship and wire into shell surfaces", () => {
    const index = readSrc("components/react-bits/index.ts");
    assert.match(index, /FadeContent|BlurText|ShinyText|StarBorder|SpotlightCard|ClickSpark|GlareHover/);
    const timeline = readSrc("widgets/TimelineView.tsx");
    assert.match(timeline, /BlurText|FadeContent|ShinyText/);
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    assert.match(tool, /SpotlightCard/);
    const composer = readSrc("widgets/composer/ComposerWidget.tsx");
    assert.match(composer, /ClickSpark|StarBorder/);
    const base = readSrc("styles/base.css");
    assert.match(base, /\.rb-shiny-text|\.rb-star-border|\.rb-spotlight-card/);
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

  it("overview, tasks, tool group, fork/rewind surfaces exist", () => {
    const app = readSrc("App.tsx");
    assert.match(app, /MultiSessionOverviewWidget/);
    assert.match(app, /TasksPanelWidget/);
    assert.match(app, /buildRewindCommand/);
    const menu = readSrc("widgets/SessionMenuWidget.tsx");
    assert.match(menu, /buildForkCommand|runSessionMenuAction/);
    const timeline = readSrc("widgets/TimelineView.tsx");
    assert.match(timeline, /groupTimelineTools|ToolGroupView/);
    assert.match(timeline, /groupTimelineThoughts|ThoughtGroupView/);
    const settings = readSrc("widgets/SettingsPanelWidget.tsx");
    assert.match(settings, /denyRules|allowRules|effort/);
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
    const diff = readSrc("widgets/timeline/DiffReviewView.tsx");
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
    assert.match(settings, /COLOR_PALETTE_OPTIONS|pickPalette|UI color/);
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
    const hook = readSrc("widgets/composer/useComposerWidget.ts");
    const attachments = readSrc("widgets/composer/useComposerAttachments.ts");
    assert.match(attachments, /processDataTransfer|handleDrop/);
    assert.match(attachments, /buildPromptBlocks|acceptImageAttachment/);
    assert.match(attachments, /showNotice/);
    assert.match(hook, /useComposerAttachments|agentCapabilities/);
    assert.doesNotMatch(
      attachments,
      /agentSupportsImageInput\(\{\s*promptCapabilities:\s*\{\s*image:\s*false/,
    );
    const store = readSrc("store/sessionStore.ts");
    assert.match(store, /blocks\?/);
    assert.match(store, /handle\.prompt\(text,\s*sid/);
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

  it("session rail is side-nav with workspace groups and workspace footer nav", () => {
    const rail = readSrc("widgets/SessionRailView.tsx");
    assert.match(rail, /side-nav/);
    assert.match(rail, /groupSessionsByProject/);
    assert.doesNotMatch(rail, /groupSessionsByTime/);
    assert.match(rail, /SessionRailProjectGroupView/);
    assert.match(rail, /orderGroupsByPin/);
    assert.match(rail, /toggleCollapsedWorkspace|onToggleCollapse/);
    assert.match(rail, /togglePinnedWorkspace|onTogglePin/);
    assert.match(rail, /New chat/);
    assert.match(rail, /selectSession/);
    assert.match(rail, /aria-label="Workspace"/);
    assert.match(rail, /side-nav-nav/);
    assert.match(rail, /detail:\s*"settings"/);
    assert.match(rail, /detail:\s*"tasks"/);
    assert.match(rail, /detail:\s*"overview"/);
    assert.match(rail, /detail:\s*"extensions"/);
    assert.doesNotMatch(rail, /backgroundColor|color:\s*['"`]#|rgb\(/);
    assert.match(rail, /project-section-label/);
    const groupView = readSrc("widgets/SessionRailProjectGroupView.tsx");
    assert.match(groupView, /project-group-name/);
    assert.match(groupView, /Show more/);
    assert.match(groupView, /PROJECT_SESSION_PREVIEW/);
    assert.match(groupView, /onToggleCollapse/);
    assert.match(groupView, /onTogglePin/);
    // Title + meta stay on separate grid tracks (long titles vs remove).
    const sessionRow = readSrc("widgets/SessionRailSessionRowView.tsx");
    assert.match(sessionRow, /sess-meta/);
    const shortcuts = readDesktopRoot("uno.shortcuts.ts");
    assert.match(
      shortcuts,
      /"sess-row":[\s\S]*?grid-cols-\[minmax\(0,1fr\)_auto\]/,
    );
    assert.match(
      shortcuts,
      /"project-group-name":\s*"min-w-0 flex-1 text-nav font-normal/,
    );
    assert.match(shortcuts, /"project-section-label":/);
  });

  it("tool card normalizes array content and plan empty is en-US", () => {
    const tool = readSrc("widgets/timeline/ToolCardView.tsx");
    assert.match(tool, /normalizeToolContentParts/);
    // Diff chrome lives in DiffReviewView (mini-diff shortcuts); tool card only composes it
    assert.match(tool, /DiffReviewView/);
    assert.doesNotMatch(tool, /mini-diff/);
    const diff = readSrc("widgets/timeline/DiffReviewView.tsx");
    assert.match(diff, /mini-diff/);
    const plan = readSrc("widgets/PlanPanelView.tsx");
    assert.match(plan, /No plan yet/);
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

    const uno = readDesktopRoot("uno.config.ts");
    assert.match(uno, /presetUno/);
    assert.match(uno, /configDeps/);
    assert.match(uno, /uno\.shortcuts\.ts/);
    assert.match(uno, /var\(--color-bg-app\)/);
    assert.doesNotMatch(uno, /text-white|bg-black|border-red-500/);

    const shortcuts = readDesktopRoot("uno.shortcuts.ts");
    assert.match(shortcuts, /side-nav/);
    assert.match(shortcuts, /composer-dock/);
    assert.match(shortcuts, /context-rail/);

    const base = readSrc("styles/base.css");
    assert.equal(
      /#[0-9a-fA-F]{3,8}\b/.test(base),
      false,
      "base.css must not contain hex colors",
    );
  });

  it("mention chips are one shared model across composer, history, and menu", () => {
    const composerInput = readSrc("widgets/composer/ComposerInputView.tsx");
    const timeline = readSrc("widgets/TimelineView.tsx");
    assert.match(composerInput, /from "@\/lib\/mentionTokens"/);
    assert.match(composerInput, /splitMentionTokens/);
    assert.match(timeline, /MentionTextView/);
    assert.match(timeline, /from "@\/widgets\/shared"/);
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

    const base = readSrc("styles/base.css");
    assert.match(base, /\.mention-chip\b/);
    assert.match(base, /\.composer-input-highlight \.composer-mention\b/);
    const mirrorStart = base.indexOf(".composer-input-highlight");
    const mirrorEnd = base.indexOf("React Bits adaptations");
    const mirrorBlock = base.slice(mirrorStart, mirrorEnd);
    assert.doesNotMatch(
      mirrorBlock,
      /^\s*(padding|margin|font-weight|letter-spacing|font-family)\s*:/m,
      "mirror-layer tokens must not change glyph metrics (caret alignment)",
    );
    assert.match(
      mirrorBlock,
      /--color-composer-mention/,
      "composer draft mentions use the dedicated accent token",
    );
    assert.doesNotMatch(
      mirrorBlock,
      /background-color:\s*var\(--color-mention-/,
      "composer draft mentions must not keep chip fill backgrounds",
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
    const rail = readSrc("widgets/SessionRailView.tsx");
    assert.match(rail, /open-panel/);
    const palette = readSrc("lib/commandPalette.ts");
    assert.match(palette, /open_settings|open_extensions|open_overview|open_tasks/);
  });
});
