# Vendored ai-inspector (ide-byebye)

Prebuilt single-file plugin from the local mira-mono checkout
(`novel/plugins/ai-inspector` → `dist/code-intent-inspector.js`), upstream
[ide-byebye](https://github.com/dravenLee/ide-byebye).

Dev-only: imported by `apps/desktop/aiInspectorDev.ts`. Do not depend on an external monorepo checkout at runtime.

Refresh after rebuilding the plugin:

```sh
# from novel/plugins/ai-inspector
npm run build
cp dist/code-intent-inspector.js \
  /path/to/grok-desktop/apps/desktop/vendor/ai-inspector/
```

Path defaults used by desktop (`aiInspectorDev.ts`):

- `pathStyle: "relative"` — source chips monorepo-relative via `agents.grokBuild.projectRoot`
- `artifactPathStyle: "absolute"` — screenshots / stills as absolute `@/…` so Grok can open them regardless of cwd

Runtime peer deps (desktop `devDependencies`): `unplugin`, `code-inspector-plugin`.
