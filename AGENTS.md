- **Comments(en-us)**: when updating any logical unit (function / declared object / component / method, including non-exported ones), update comments in sync — describe purpose, role, boundaries, parameter meaning, return-value meaning, and consequences of missing or wrong arguments; variables need comments too

## Agent connection policy (hard product constraint)

- **Must** connect to real **grok-build** (`grok agent stdio` / bridge spawn real CLI)
- **Forbidden** to use mock agent, offline fixture, or fake echo as product / acceptance paths
- UI default and send path allow only `live-bridge`; if bridge is unavailable, fail — do not silently fall back to mock
- In-process mock in unit tests (`createMockAcpPair`) is only for protocol/codec isolation tests; must not be wired into the `npm run dev` main path

These are the project's hard constraints and take highest priority.
- **测试位置**：测试文件一律放在所属 workspace 的 `test/` 下，目录结构镜像 `src/`；
  `src/` 内不得出现 `*.test.*` / `*.spec.*`。desktop 测试用 `@/` 别名导入被测模块，
  bridge / acp-core 用 `../src/xxx.js` 相对路径。
- Consider splitting files at 200 lines; must split above 440 lines
- **Colors**: all color tokens / theme colors are centralized in `src/styles/defineColor.css`; see "Color rules" below
- **Styles**: prefer UnoCSS; write as few `.css` files as possible
- **UI control library (shadcn-only)**: new / updated "reusable pure UI controls" (buttons, inputs, dialogs, dropdowns, Tabs, Tooltip, and other generic presentation controls) must be based on shadcn/ui — `npx shadcn@latest add <name>` into `src/components/ui/` (if the CLI fails in this environment, hand-write from its source into the same directory); compose classes with `cn` (`@/lib/utils`); **do not** run `shadcn init`
  - Prefer reusing components in `src/components/ui`; do not reimplement
  - Icons use `lucide-react` uniformly (funneled through `StoryEditorModeIconView`)
  - Default classNames of shadcn primitives are already bridged to the app's `--color-*` tokens (see `src/components/ui/*`); for new primitives, likewise map surface/border/text to app tokens — do not leave stone-gray defaults
  - Editor selection toolbar / replace / AI snippet and other "anchor-following" overlays do not use Radix Popover; use `src/widgets/editor/shared/EditorAnchoredPopover` uniformly (portal + imperative `updatePosition`, keep zero-latency scroll follow)
  - shadcn runs on UnoCSS (`unocss-preset-shadcn`); colors still follow "Color rules" below (`bg-primary` etc. keep existing theme literal values)
- **Dynamic className**: use `classnames` uniformly; conditional classes use object form, not inline `style`
  ```javascript
  // Preferred
  cs('xxxx', { 'c1 c2 c3': bool1 });
  // Not preferred
  cs('xxxx', bool1 ? 'c1 c2 c3' : '');
  ```
- **icon**: render uniformly via `StoryEditorModeIconView`; SVGs under `icon/source` are already built by svg-sprite — do not import them separately
- **Buttons**: prefer semantic class buttons already defined in Uno shortcuts (`btn-ghost`, `btn-new-chat`, `shell-toggle`, `turn-step`, `msg-action-btn`, etc.) so chrome matches the shell IA; do not invent ad-hoc button chrome
  - Primary / secondary product actions that need a shared primitive go through shadcn `Button` in `src/components/ui` (see "UI control library") when a generic control is missing
  - Collapsible rail/step headers use `CollapsibleStepView` from `@/widgets/shared` rather than re-implementing chevron + `aria-expanded` chrome
- **Widget registration**: new features register as exports in `src/widgets/<feature>/index.*`; if `src/widgets/index.*` exists, export there too. Upper layers import from `src/widgets/<feature>`, not deep relative paths into internals
- **Prefer functional style**: utility methods should be pure functions when possible
- **Declaration order (const first)**: in the same scope / function body, declare all `const` first, then all `let`.
- **No `eslint-disable`**: do not use `eslint-disable` / `eslint-disable-next-line` / `eslint-disable-line` or similar to bypass lint; fix the code instead of disabling the rule
- **Leave rendering to React; do not write DOM imperatively**: attributes that affect render (`style` / `className` / `transform`, etc.) must not be written back to the DOM imperatively — compute them as state and let React render. Reading / measuring the DOM (`getComputedStyle`, `getBoundingClientRect`, etc.) is allowed, but results must flow back as state, not be written to the DOM directly
- **Do not add SVG fragments in business code**

## Color rules

- **Location**: all color definitions may only live in `src/styles/defineColor.css`; if a subproject does not have this file yet, add it on first color work
- **Carrier**: use CSS variables; prefer semantic names `--color-*` / `--gradient-*` / `--shadow-*` (including gradients, shadows, borders, fills, hover, disabled)
- **Workflow**: for new / changed colors, edit `defineColor.css` first, then consumers; consumers may only use registered variables or classes built on those variables
- **Forbidden** (in `ts` / `tsx`):
  - Color literals: `#fff`, `rgb(...)`, `rgba(...)`, `hsl(...)`, English color names
  - Color-related inline `style`: `color`, `background`, `backgroundColor`, `borderColor`, `boxShadow`, `fill`, `stroke`, etc.
  - Color-related UnoCSS classes: `text-white`, `bg-black`, `border-red-500`, `from-blue-500`, `to-green-400`, etc.
- Historical aliases may only be mapped in `defineColor.css`; do not spread them in business code

## Component types and splitting

- Distinguish `Stateless` (pure presentation: no store, no requests, no `useState` / `useEffect`) from `Stateful` (connects store, orchestrates state and requests)
- Keep `Stateful` thin (connect and assemble), `Stateless` thick (structure and presentation); when a presentation unit needs state, wrap inner `Stateless` with outer `Stateful`
- Name `Stateful` components `*Widget`
- Each widget exposes one unified entry hook (e.g. `useEditorWidget()`) that composes local state / store / actions / derived data / events; pages should prefer that hook — leaf components should not each connect the store directly
- Avoid prop drilling: if depth exceeds 2 layers, consider store or React Context
- Ternary operators nested more than 2 levels in JSX must be split into widgets with narrower responsibilities

## Render boundaries

**Sink high-frequency state**; the page only holds shared / stable / route / data-source state.

- Input, selection, overlay position, drag, autosave, scroll, drafts, etc. → nearest `Stateful Widget` / hook; **do not** lift to page, **do not** put in global store
- Do not assemble a huge `state` on the page and spread it across the whole page
- Subscribe to the store by field precisely (prefer field over object, prefer widget over page); when parents re-render, evaluate `React.memo` on heavy panels and keep props stable

## Pre-commit self-check
- lint has no errors / warnings
