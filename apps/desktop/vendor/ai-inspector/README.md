# Vendored ai-inspector (ide-byebye)

Prebuilt single-file plugin from [ide-byebye](https://github.com/dravenLee/ide-byebye) (`dist/code-intent-inspector.js`).

Dev-only: imported by `apps/desktop/aiInspectorDev.ts`. Do not depend on an external monorepo checkout.

Refresh after rebuilding ide-byebye:

```sh
cp /path/to/ide-byebye/dist/code-intent-inspector.js apps/desktop/vendor/ai-inspector/
```

Runtime peer deps (desktop `devDependencies`): `unplugin`, `code-inspector-plugin`.
