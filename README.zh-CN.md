[README](README.md) · [README (zh)](README.zh-CN.md)

# grok-desktop

[grok-build](https://docs.x.ai/build/overview) 的桌面客户端。通过 stdio 与真实的 `grok agent stdio` 进程讲 Agent Client Protocol（ACP）—— agent 循环留在 grok-build，这里只做它的窗口。

> 遇到 bug 或想要新功能？欢迎[提 issue](https://github.com/bo-516/grok-desktop/issues)。

| 文档 | 内容 |
|---|---|
| [`apps/bridge-go/README.md`](apps/bridge-go/README.md) | Go 桥环境变量、进程池、CLI 通道 |
| [`apps/shell/README.md`](apps/shell/README.md) | Wails 宿主、配置、日志 |
| [`docs/design/ui-ux-agent-client.md`](docs/design/ui-ux-agent-client.md) | 壳层信息架构与视觉设计 |
| [`docs/protocol-freeze-relay-2026-08-10.md`](docs/protocol-freeze-relay-2026-08-10.md) | Bridge ↔ UI WebSocket 中继 |
| [`docs/qa/index.md`](docs/qa/index.md) | 按界面拆分的 QA 用例 |

## 只连真实 grok-build

| 允许 | 绝不 |
|---|---|
| `npm run bridge` / `npm run m0:live` / `npm run demo:e2e` 拉起 `grok agent stdio` | Mock agent UI、把离线 fixture 当「会话」、静默回退到 mock |
| `demo/` 下的演示工作区 | 把 mock 假装成 live agent |

单元测试可以用进程内 ACP mock，仅隔离 codec / timeline，不得接到产品路径。

## 目录

```
packages/acp-core/   纯协议编解码、时间线 reduce、AcpClient
apps/bridge/         Node RuntimePool：真实 `grok agent stdio` + WebSocket
apps/bridge-go/      Go 桥（有二进制时为产品默认）
apps/desktop/        Vite + React 壳（只走 live-bridge）
apps/shell/          Wails v3 宿主 — 自己拉桥进程，嵌入 UI
apps/m0/             CLI 握手（默认只走 live）
demo/                `demo:e2e` / `m0:live` 的受限沙箱
```

## 环境

- Node.js ≥ 20
- **产品路径必须有**：PATH 上的 `grok`（或 `~/.grok/bin/grok`），并完成 `grok login` / 鉴权
  - 鉴权：`grok login`（写入 `~/.grok/auth.json`）**或** 环境变量 `XAI_API_KEY`
  - 桥回报缺凭证时，UI 会显示鉴权横幅
- **可选，用于 Go 桥 / 桌面窗口**：Go 1.25+
  - `cd apps/bridge-go && go build -o bin/bridge-go ./cmd/bridge`
  - Wails 壳见 [`apps/shell/README.md`](apps/shell/README.md)

## 安装

```bash
npm install
```

## 运行（真实 agent）

界面三列：**会话栏 · 时间线 · Plan / Agents**。输入框在转录区下方。

```bash
# 终端 A — 真实 grok-build（优先 go-bridge；没有二进制再用 Node）
# 默认工作区 = 本仓库。可用 BRIDGE_CWD=… 覆盖
npm run bridge

# 终端 B — Web UI（自动连桥；无 mock）
npm run dev
```

打开 http://localhost:8172。

一个进程同时起 **Web + 桌面**（Vite HMR 和 Wails 窗口；各自拥有独立 live bridge）：

```bash
npm run run:both
# 用 Node 桥而不是 Go：npm run run:node-both
# 交互菜单（web / desktop / both × Go / Node）：npm run run:dev
```

| 命令 | 作用 |
|---|---|
| `npm run bridge` | 存在 `apps/bridge-go/bin/bridge-go` 则走 Go，否则 Node |
| `npm run dev` | Vite Web UI，端口 `:8172` |
| `npm run run:both` | Go：Vite Web + Wails 桌面（两套隔离的桥） |
| `npm run run:go-web` / `run:node-web` | 一个 Web UI + 对应的桥 |
| `npm run run:go-desktop` / `run:node-desktop` | Wails 窗口（壳自己拉桥） |

### 工作区

- **开发（本仓库，未设 `BRIDGE_CWD`）**：monorepo 根目录，聊天和代码在一起
- **打包 / 附近没有源码树**：macOS、Windows、Linux 均为 `Documents/Grok`
- **`demo/`**：只给 `demo:e2e` / `m0:live` 用的受限沙箱 — 不是默认聊天 cwd

### 当前能力

- **多会话**：每个 live 会话一个 `grok agent stdio` 进程；后台会话继续流式输出
- **LRU 池**：默认容量 **8**（`BRIDGE_POOL_CAPACITY`）；只回收 **空闲** 会话；池满且全忙时等待空位
- **会话栏**：按项目分组、独立的无项目区、状态点（含后台 live）、行内改名、「显示更多」
- **冷启动**：磁盘 `chat_history` / `updates.jsonl` 立刻上屏；`session/load` 仍会恢复真实 agent
- **扇出**：harness 子会话不进栏；在 **Agents** 侧栏查看，不必离开父画布
- **时间线**：流式 markdown（围栏、列表、粗体/代码）、Shiki、KaTeX、工具卡片、原生 diff 审阅、文档预览
- **输入框**：Enter 发送，Shift+Enter 换行；Ask / Plan / Build；Thinking；`/model` `/effort` `/fork` `/rewind`；后续队列；上下文占用环；每周剩余额度
- **⌘K**：动作、设置、slash 草稿、MCP 服务器、skills（会话仍在侧栏）
- 桥断开 → 离线横幅；历史仍可看；**每 3 秒自动重连**（页脚 Reconnect 仍可用）

### Live e2e（stdio、工具、subagent）

```bash
npm run demo:e2e
# 日志：demo/e2e-last-run.log
```

### M0 握手（live）

```bash
M0_CWD="$(pwd)/demo" npm run m0:live
```

`npm run m0` 只走 live（无 mock 回退）。`--mock` 仅用于隔离的协议实验，并会打印警告。

## 测试

```bash
npm run test:all
npm run typecheck
npm run lint
```

协议单测可以用 mock transport；不能代替真实 agent 验收。

## 核心 API

```ts
import {
  AcpClient,
  applySessionUpdate,
  mergeBridgeSnapshot,
  parseBillingResponse,
  parseTokenUsageRpc,
} from "@grok-desktop/acp-core";
```

- `tool_call_update` **补丁合并**进 `toolCalls[toolCallId]`
- 会话状态：`idle` | `streaming` | `waiting_permission` | `disconnected`
- Go 桥空的 `state` 帧不会冲掉客户端持有的 timeline / goal / subagent
- 占用率（`contextTokensUsed`）在 `turn_completed` 账单计数覆盖后仍保留
