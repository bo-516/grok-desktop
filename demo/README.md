# grok-desktop demo workspace

Constrained playground for live `grok agent stdio` runs.

Agent work must stay **inside this folder only**.

## Files

| Path | Purpose |
|---|---|
| `src/hello.ts` | Tiny starter module for edit demos |
| `src/math.ts` | Functions a subagent can test/refactor |
| `TASKS.md` | Checklist for multi-step demos |

## Run agent against this cwd

```bash
# from repo root
M0_CWD="$(pwd)/demo" M0_PROMPT="List files in this workspace" npm run m0:live

# full bridge + UI
npm run bridge
# other terminal: npm run dev
```
