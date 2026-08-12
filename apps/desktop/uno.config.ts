/**
 * UnoCSS config for grok-desktop.
 * Theme colors map to defineColor.css tokens only (no raw palette classes in UI).
 * Semantic shortcuts replace former layout CSS modules.
 */
import {
  defineConfig,
  presetUno,
  transformerVariantGroup,
} from "unocss";
import { appShortcuts } from "./uno/shortcuts";

/** Semantic color tokens → CSS variables from defineColor.css */
const colors = {
  app: "var(--color-bg-app)",
  surface: "var(--color-bg-surface)",
  elevated: "var(--color-bg-elevated)",
  timeline: "var(--color-bg-timeline)",
  composer: "var(--color-bg-composer)",
  "composer-suggestion": "var(--color-bg-composer-suggestion)",
  "composer-suggestion-hover": "var(--color-bg-composer-suggestion-hover)",
  sidebar: "var(--color-bg-sidebar)",
  "sidebar-hover": "var(--color-bg-sidebar-hover)",
  titlebar: "var(--color-bg-titlebar)",
  user: "var(--color-bg-user)",
  tool: "var(--color-bg-tool)",
  overlay: "var(--color-bg-overlay)",
  high: "var(--color-surface-high)",
  highest: "var(--color-surface-highest)",
  container: "var(--color-surface-container)",
  "white-soft": "var(--color-bg-white-soft)",
  "white-faint": "var(--color-bg-white-faint)",
  "white-hover": "var(--color-bg-white-hover)",
  kbd: "var(--color-bg-kbd)",
  skeleton: "var(--color-bg-skeleton)",
  "skeleton-mid": "var(--color-bg-skeleton-mid)",
  "skeleton-faint": "var(--color-bg-skeleton-faint)",
  primary: "var(--color-primary)",
  "on-primary": "var(--color-on-primary)",
  accent: "var(--color-accent)",
  "accent-hover": "var(--color-accent-hover)",
  "accent-muted": "var(--color-accent-muted)",
  danger: "var(--color-danger)",
  "danger-muted": "var(--color-danger-muted)",
  warning: "var(--color-warning)",
  "warning-muted": "var(--color-warning-muted)",
  success: "var(--color-success)",
  "success-muted": "var(--color-success-muted)",
  fg: "var(--color-text-primary)",
  "fg-secondary": "var(--color-text-secondary)",
  "fg-muted": "var(--color-text-muted)",
  "fg-faint": "var(--color-text-faint)",
  "fg-inverse": "var(--color-text-inverse)",
  "fg-suggestion-detail": "var(--color-text-composer-suggestion-detail)",
  "fg-suggestion-kind": "var(--color-text-composer-suggestion-kind)",
  line: "var(--color-border-default)",
  "line-subtle": "var(--color-border-subtle)",
  "line-muted": "var(--color-border-muted)",
  "line-strong": "var(--color-border-strong)",
  "line-focus": "var(--color-border-focus)",
  "rail-line": "var(--color-rail-line)",
  "line-suggestion": "var(--color-border-composer-suggestion)",
  /* Composer field chrome (wrap sole owner — color only per state) */
  field: "var(--color-border-field)",
  "field-focus": "var(--color-border-field-focus)",
  "field-listening": "var(--color-border-field-listening)",
  "field-dragover": "var(--color-border-field-dragover)",
  "field-dragover-bg": "var(--color-bg-field-dragover)",
  "diff-add": "var(--color-diff-add)",
  "diff-add-bg": "var(--color-diff-add-bg)",
  "diff-del": "var(--color-diff-del)",
  "diff-del-bg": "var(--color-diff-del-bg)",
  "mention-file": "var(--color-mention-file)",
  "mention-file-bg": "var(--color-mention-file-bg)",
  "mention-dir": "var(--color-mention-dir)",
  "mention-dir-bg": "var(--color-mention-dir-bg)",
  "mention-command": "var(--color-mention-command)",
  "mention-command-bg": "var(--color-mention-command-bg)",
  "mention-skill": "var(--color-mention-skill)",
  "mention-skill-bg": "var(--color-mention-skill-bg)",
  /* Syntax kinds emitted by the highlighter theme (see codeHighlight.ts) */
  "code-keyword": "var(--color-code-keyword)",
  "code-control": "var(--color-code-control)",
  "code-type": "var(--color-code-type)",
  "code-tag": "var(--color-code-tag)",
  "code-string": "var(--color-code-string)",
  "code-string-expression": "var(--color-code-string-expression)",
  "code-comment": "var(--color-code-comment)",
  "code-constant": "var(--color-code-constant)",
  "code-number": "var(--color-code-number)",
  "code-function": "var(--color-code-function)",
  "code-punctuation": "var(--color-code-punctuation)",
  "code-variable": "var(--color-code-variable)",
  "code-parameter": "var(--color-code-parameter)",
  "code-link": "var(--color-code-link)",
} as const;

export default defineConfig({
  /**
   * External modules imported by this config (not auto-discovered by UnoCSS).
   * Without them, edits to shortcuts only apply after a full Vite restart —
   * the common "UI changed but HMR did nothing" failure after the UnoCSS migration.
   */
  configDeps: [
    "uno/shortcuts.ts",
    "uno/shortcuts.sidenav.ts",
    "uno/shortcuts.shell.ts",
    "uno/shortcuts.timeline.ts",
    "uno/shortcuts.composer.ts",
    "uno/shortcuts.chrome.ts",
    "uno/shortcuts.preview.ts",
    "uno/shortcuts.code.ts",
  ],
  /**
   * Colon only. UnoCSS also accepts `-` as a variant separator by default, so
   * every `md-*` shortcut (Markdown chrome) parsed as the `md:` breakpoint
   * variant — `md-table` became `@media(min-width:768px){display:table}` and the
   * shortcut never emitted. All variants in this app are written `variant:`.
   */
  separators: [":"],
  /*
   * UnoCSS only scans .tsx/.html by default, so class literals that live in
   * plain .ts data modules never emitted — the palette picker's swatch classes
   * come from src/lib/colorPalette.ts, which is why every colour dot rendered
   * as a 0x0 transparent span. Scoped to src/ on purpose: scanning
   * uno/shortcuts.*.ts would emit every utility inside a shortcut body as a
   * standalone class.
   */
  content: {
    pipeline: {
      include: [/\.([jt]sx|html)($|\?)/, /[\\/]src[\\/].*\.ts($|\?)/],
    },
  },
  presets: [
    presetUno({
      // defineColor/base own document chrome; avoid double preflight fights
      preflight: false,
    }),
  ],
  transformers: [transformerVariantGroup()],
  theme: {
    colors,
    fontFamily: {
      sans: "var(--font-sans)",
      mono: "var(--font-mono)",
    },
    borderRadius: {
      control: "var(--radius-control)",
      card: "var(--radius-card)",
      shell: "var(--radius-lg)",
      bubble: "var(--radius-bubble)",
      modal: "var(--radius-modal)",
      soft: "var(--radius-sm)",
      kbd: "var(--radius-kbd)",
      pill: "var(--radius-pill)",
      dock: "var(--radius-full)",
    },
    boxShadow: {
      modal: "var(--shadow-modal)",
      popover: "var(--shadow-popover)",
      composer: "var(--shadow-composer)",
      "composer-suggestions": "var(--shadow-composer-suggestions)",
    },
    maxWidth: {
      chat: "var(--chat-max-width)",
    },
    width: {
      sidebar: "var(--sidebar-width)",
      "rail-right": "var(--rail-right-width)",
      "side-panel": "400px",
      palette: "520px",
      "env-sheet": "960px",
      "env-nav": "200px",
    },
    height: {
      topnav: "var(--topnav-height)",
    },
    spacing: {
      container: "var(--container-padding)",
    },
    duration: {
      fast: "var(--duration-fast)",
      normal: "var(--duration-normal)",
      slow: "var(--duration-slow)",
    },
    easing: {
      soft: "var(--ease-soft)",
      out: "var(--ease-out)",
    },
    fontSize: {
      "body-sm": ["var(--font-size-body-sm)", "var(--line-height-body-sm)"],
      "body-md": ["var(--font-size-body-md)", "var(--line-height-body-md)"],
      nav: ["var(--font-size-nav-item)", "var(--line-height-nav-item)"],
      mono: ["var(--font-size-mono-label)", "var(--line-height-mono-label)"],
      headline: [
        "var(--font-size-headline-sm)",
        "var(--line-height-headline-sm)",
      ],
    },
    animation: {
      keyframes: {
        "skeleton-pulse":
          "{0%,100%{opacity:0.55}50%{opacity:1}}",
        "cursor-blink": "{50%{opacity:0}}",
        "overlay-in": "{from{opacity:0}to{opacity:1}}",
        "modal-in":
          "{from{opacity:0;transform:translateY(6px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}",
        /* Mic live indicator — soft opacity pulse, not a layout thrash. */
        "mic-pulse":
          "{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.45;transform:scale(0.85)}}",
        /*
         * Live-turn strip. The orb ping is a radar ring that scales out of an
         * 8px box (transform inside keyframes is raw CSS, so it does not need
         * presetUno's --un-translate plumbing); the strip entrance is a short
         * rise so the dock growing by one row does not read as a jump cut.
         */
        "turn-orb-ping":
          "{0%{transform:scale(0.9);opacity:0.5}70%,100%{transform:scale(2.4);opacity:0}}",
        "turn-status-in":
          "{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}",
      },
      durations: {
        "skeleton-pulse": "1.4s",
        "cursor-blink": "1.05s",
        "overlay-in": "var(--duration-normal)",
        "modal-in": "var(--duration-slow)",
        "mic-pulse": "1.2s",
        "turn-orb-ping": "1.8s",
        "turn-status-in": "var(--duration-slow)",
      },
      timingFns: {
        "skeleton-pulse": "var(--ease-soft)",
        "cursor-blink": "step-end",
        "overlay-in": "var(--ease-soft)",
        "modal-in": "var(--ease-out)",
        "mic-pulse": "var(--ease-soft)",
        "turn-orb-ping": "var(--ease-out)",
        "turn-status-in": "var(--ease-out)",
      },
      counts: {
        "skeleton-pulse": "infinite",
        "cursor-blink": "infinite",
        "mic-pulse": "infinite",
        "turn-orb-ping": "infinite",
      },
    },
  },
  shortcuts: appShortcuts,
    rules: [
    ["group", {}],
    ["caret-fg", { "caret-color": "var(--color-text-primary)" }],
    [/^text-(\d+)px$/, ([, d]) => ({ "font-size": `${d}px` })],
    [/^leading-(\d+)px$/, ([, d]) => ({ "line-height": `${d}px` })],
    [/^rounded-(\d+)px$/, ([, d]) => ({ "border-radius": `${d}px` })],
    [/^w-(\d+(?:\.\d+)?)px$/, ([, d]) => ({ width: `${d}px` })],
    [/^h-(\d+(?:\.\d+)?)px$/, ([, d]) => ({ height: `${d}px` })],
    [
      /^backdrop-blur-(\d+)px$/,
      ([, d]) => ({
        "backdrop-filter": `blur(${d}px)`,
        "-webkit-backdrop-filter": `blur(${d}px)`,
      }),
    ],
    ["left-sidebar", { left: "var(--sidebar-width)" }],
    ["ml-sidebar", { "margin-left": "var(--sidebar-width)" }],
    ["pt-topnav", { "padding-top": "var(--topnav-height)" }],
    ["right-rail", { right: "var(--rail-right-width)" }],
    ["pr-rail", { "padding-right": "var(--rail-right-width)" }],
    ["translate-x-rail", { transform: "translateX(var(--rail-right-width))" }],
    /* Own-width off-screen slide (preview/plan closed state; not rail token). */
    ["translate-x-full", { transform: "translateX(100%)" }],
    ["translate-x-none", { transform: "translateX(0)" }],
    [
      "px-container",
      {
        "padding-left": "var(--container-padding)",
        "padding-right": "var(--container-padding)",
      },
    ],
    [
      "mx-container",
      {
        "margin-left": "var(--container-padding)",
        "margin-right": "var(--container-padding)",
      },
    ],
    /*
     * Standalone transforms. presetUno's transform utilities compose through
     * --un-translate / --un-skew / --un-scale custom properties that only its
     * preflight defines, and preflight is off here — the generated
     * `transform: translate(var(--un-translate-x)) …` is invalid and drops the
     * whole declaration. Anything that must actually move gets a plain rule.
     */
    ["scale-96", { transform: "scale(0.96)" }],
    ["rotate-90", { transform: "rotate(90deg)" }],
    ["rounded-inherit", { "border-radius": "inherit" }],
    ["tabular-nums", { "font-variant-numeric": "tabular-nums" }],
    ["tracking-tight", { "letter-spacing": "var(--letter-spacing-tight)" }],
    /* Composer suggestion menu: kill scroll-anchoring jumps while the list filters. */
    ["overflow-anchor-none", { "overflow-anchor": "none" }],
    /* Reserve scrollbar width so ellipsis width does not reflow when overflow starts. */
    ["scrollbar-gutter-stable", { "scrollbar-gutter": "stable" }],
    [
      "transition-width",
      {
        "transition-property": "width",
        "transition-timing-function": "var(--ease-out)",
      },
    ],
    [
      "bg-gradient-composer",
      { background: "var(--gradient-composer-fade)" },
    ],
    ["animate-delay-120", { "animation-delay": "0.12s" }],
    ["animate-delay-240", { "animation-delay": "0.24s" }],
    ["z-90", { "z-index": "90" }],
    ["z-95", { "z-index": "95" }],
    ["z-100", { "z-index": "100" }],
    ["w-1.25", { width: "0.3125rem" }],
    ["h-1.25", { height: "0.3125rem" }],
    ["w-5.5", { width: "1.375rem" }],
    ["h-5.5", { height: "1.375rem" }],
    ["w-7.5", { width: "1.875rem" }],
    ["h-7.5", { height: "1.875rem" }],
    ["h-8.5", { height: "2.125rem" }],
    ["h-0.75", { height: "0.1875rem" }],
    ["h-2.75", { height: "0.6875rem" }],
    ["h-5.25", { height: "1.3125rem" }],
    ["px-2.25", { "padding-left": "0.5625rem", "padding-right": "0.5625rem" }],
    ["px-3.75", { "padding-left": "0.9375rem", "padding-right": "0.9375rem" }],
    ["py-1.75", { "padding-top": "0.4375rem", "padding-bottom": "0.4375rem" }],
    ["py-2.25", { "padding-top": "0.5625rem", "padding-bottom": "0.5625rem" }],
    ["py-2.75", { "padding-top": "0.6875rem", "padding-bottom": "0.6875rem" }],
    ["px-2.75", { "padding-left": "0.6875rem", "padding-right": "0.6875rem" }],
    ["pb-2.75", { "padding-bottom": "0.6875rem" }],
    ["gap-1.25", { gap: "0.3125rem" }],
    ["px-4.5", { "padding-left": "1.125rem", "padding-right": "1.125rem" }],
    ["max-w-70", { "max-width": "17.5rem" }],
  ],
});
