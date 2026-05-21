# Raltic Agent Platform v2 — CF-Native Architecture & Product Upgrade

Status: Draft v1 (2026-05-20)
Owner: TBD
Reviewers: TBD

---

## 0. Executive Summary

**Problem.** Today every Raltic Agent runs as a local `claude` / `codex` / `gemini` / `copilot` subprocess inside the user's own bridge daemon. This delivers genuine Claude-Code-grade capabilities but excludes ~95% of potential users (anyone who isn't a developer comfortable with terminal + Node + Anthropic login + LaunchAgent setup). The bridge model also locks us out of mobile, prevents teamwide sharing, and creates a long support tail for PATH/auth/firewall issues.

**Solution.** Move the Agent's *execution location* into Cloudflare's stack while keeping the same capability surface — Read / Write / Edit / Bash / Grep / persistent memory / multi-step planning. We build on three CF-native pieces:

- **Cloudflare Agents SDK** for the agent loop (each Agent is a Durable Object subclass; state, hibernation, alarms come free).
- **AI Gateway** as the single egress for all model providers (Anthropic / OpenAI / Gemini / Workers AI) with caching, rate-limit, fallback, BYO-key, and per-tenant budgets.
- **Cloudflare Containers** as the per-Agent sandbox (~350 MB image, holds Linux toolchain + a thin RPC daemon, sleep-on-idle, R2-mounted workspace).

The architecture cleanly separates the Agent's **brain** (a DO running the loop) from its **body** (a sandbox container executing OS-level tools). Existing local bridge remains as a power-user / privacy-focused mode.

**Outcomes targeted.**

- Time-to-first-agent-output drops from ~10 min (install bridge + auth) to <90 s (signup → agent working).
- Mobile usable.
- Container resource footprint per agent: ~350 MB image, ~40 MB idle RAM, ~$4-12/mo active.
- Zero net loss for current bridge users.

---

## 1. 现状盘点

### 1.1 当前架构（简）

```
Web (Next.js)  ─→  raltic-api (Hono on Worker)  ─→  D1 / R2 / KV / DOs
                                                       │
                                                       └─ ChatRoom DO, UserGateway DO
                       
User's Mac:    bridge (Node) ─ spawn ─→ claude / codex / gemini / copilot CLI
                                              │
                                              └─ uses `raltic` CLI (PATH-injected) to call API
```

### 1.2 产品定位

Raltic = "人 + Agent 共享的协作平台"。Agent 是一等公民：有身份、频道成员资格、DM、可以被 @-mention。Agent 不是 chatbot wrapper，而是 Claude Code / Codex 级别的真实工程 agent。

### 1.3 当前痛点

| # | 痛点 | 影响 |
|---|---|---|
| 1 | 需要本地安装 + Node + npm + 认证 + LaunchAgent | 把非技术用户全部挡在门外 |
| 2 | Bridge 进程飘移 / 失联 / PATH 冲突 | 高支持成本，活跃用户流失 |
| 3 | 移动端完全不可用 | 错失日常 50% 使用场景 |
| 4 | Agent 状态 = 用户本机文件 | 团队共享、跨设备协作做不了 |
| 5 | 每个用户必须自己拿 Anthropic / OpenAI API key | 计费、配额、商业化没抓手 |
| 6 | 4 个 runtime CLI 升级不同步 | 兼容性 bug 时不时出现 |

### 1.4 不变的产品承诺

无论架构怎么变，下面这些**不能降级**：

- Agent 能 Read/Write/Edit 真实文件
- Agent 能 Bash 跑真实命令
- Agent 能多步规划长任务
- Agent 有持久 memory
- Agent 之间能协作（通过频道 / DM）
- 人和 Agent 在同一频道里平等参与

---

## 2. 目标产品形态

### 2.1 三种 Agent Runtime 模式

```
                ┌─────────────────────────────────────────────┐
                │  Agent = 同一套能力 (Read/Write/Bash/...)    │
                └──────────────────────┬──────────────────────┘
                                       │
                              执行位置可选
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
┌──────────────────┐         ┌────────────────────┐         ┌──────────────────┐
│ Cloud (默认)      │         │ Connector-only     │         │ Local Bridge     │
│                   │         │ (轻量, 移动端)     │         │ (隐私/quota 党)  │
│ RalticAgent DO   │         │                    │         │                  │
│ + Sandbox        │         │ RalticAgent DO     │         │ 现有方案不动     │
│ Container        │         │ (无 sandbox)       │         │                  │
│                   │         │                    │         │                  │
│ 完整 OS 工具      │         │ 只有 web / API /   │         │ 用户本地 CLI     │
│ 持久 workspace    │         │ connector tools    │         │ 全权限 FS        │
│                   │         │                    │         │                  │
│ 工程/PM/Designer │         │ 移动端临时操作      │         │ Senior dev       │
│ 95% 用户          │         │ 5% 用户            │         │ 5% 用户          │
└──────────────────┘         └────────────────────┘         └──────────────────┘
```

**默认创建 = Cloud mode**。其他两种是 toggle。

### 2.2 用户旅程对比

```
                    Cloud (默认)         Connector-only        Local Bridge

注册 → 第一条消息   ~ 90 秒              ~ 60 秒              ~ 10 分钟
                                                              (装 bridge + login)

可在手机使用        ✅                   ✅                   ❌

可让 agent 改       ✅ (workspace 在     ❌                   ✅ (本地 repo)
代码                 云端, 通过 GH OAuth
                    clone 进来)

agent 跑 Bash       ✅ (sandbox 容器)    ❌                   ✅ (本地)

数据落在            CF (R2 + D1)         CF                   用户本机
```

### 2.3 Persona 例子

- **PM Lily**：注册 → 默认 Cloud Agent → 它自动从 Notion / Linear 同步资料 → 让它"汇总过去 7 天 #marketing 频道并起草给 CEO 的周报" → 90 秒内有 draft。
- **Founder Sam**：注册 → Cloud Agent → 选 "Connect GitHub" → 选 repo → workspace clone 完成 → "把所有 console.log 改成结构化 logger" → agent 在云端跑 → push PR。整个过程 4 分钟，零本地安装。
- **Senior Eng Mei**：仍然选 Local Bridge → 装 `npx -y @raltic/bridge` → 沿用现有体验。

---

## 3. 目标架构

### 3.1 全景图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       raltic.com (Next.js / OpenNext)                    │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐    │
│  │ Channels    │ │ Workspace   │ │ Connector    │ │ Billing /        │    │
│  │ + DMs       │ │ IDE pane    │ │ store        │ │ API key vault    │    │
│  │             │ │ (Cloud only)│ │ (OAuth)      │ │                  │    │
│  └─────────────┘ └─────────────┘ └──────────────┘ └─────────────────┘    │
│                                                                          │
│  useAgentChat() ←── CF Agents SDK 提供, WSS 流式                         │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │ WSS
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   raltic-api (Hono on CF Worker)                         │
│   Auth (cookie / api_token / bridge_token) · policy.canX()               │
│   REST CRUD · WS upgrade                                                 │
└──┬─────────┬──────────────┬────────────────────┬────────────────┬────────┘
   │         │              │                    │                │
   ▼         ▼              ▼                    ▼                ▼
┌────────┐┌────────────┐┌─────────────────────┐┌──────────────┐┌─────────────┐
│ChatRoom││UserGateway ││  RalticAgent DO     ││ ConnectorHub ││ Sync Workers│
│  DO    ││    DO      ││  (extends Agent)    ││              ││ (Cron + WH) │
│        ││            ││                     ││ OAuth tokens ││             │
│ 现有   ││ 现有 +     ││  ★ 新增, CF Agents  ││ + API proxy  ││ Notion API  │
│        ││ 新增容器   ││    SDK base class   ││ to GH/Linear ││ → R2 → 同步 │
│        ││ 调度       ││                     ││ /Notion/...  ││ 进 sandbox  │
│        ││            ││  state.history      ││              ││ /workspace  │
│        ││            ││  state.todoList     ││              ││             │
│        ││            ││  state.containerId  ││              ││             │
│        ││            ││                     ││              ││             │
│        ││            ││  onMessage(msg):    ││              ││             │
│        ││            ││   ai-gateway        ││              ││             │
│        ││            ││    .streamText({    ││              ││             │
│        ││            ││     model, tools,   ││              ││             │
│        ││            ││     messages})      ││              ││             │
│        ││            ││   → tool dispatch   ││              ││             │
│        ││            ││                     ││              ││             │
│        ││            ││  alarm: 定时任务    ││              ││             │
│        ││            ││  hibernate: 自动    ││              ││             │
│        ││            ││  storage.sql: memory││              ││             │
└────────┘└──────┬─────┘└──────┬──────────────┘└──────┬───────┘└──────┬─────┘
                 │             │ tool dispatch:        │               │
                 │             ▼                       ▼               ▼
                 │   ┌──────────────────────┐  ┌──────────────┐ ┌──────────────┐
                 │   │ in-Worker tools      │  │ Connector    │ │ Vectorize    │
                 │   │ search_messages      │  │ tools        │ │ (workspace   │
                 │   │ post_to_channel      │  │ github_*     │ │  message     │
                 │   │ create_task          │  │ linear_*     │ │  embeddings) │
                 │   │ web_fetch            │  │ notion_*     │ │              │
                 │   └──────────────────────┘  │ gdrive_*     │ └──────────────┘
                 │                             └──────────────┘
                 │                                                              
                 │   Container RPC                                              
                 ▼   (tool dispatch for FS / Bash)                              
       ┌────────────────────────────────────────────┐                          
       │  Per-Agent Sandbox Container               │                          
       │  ─────────────────────────────────────     │                          
       │  Image: ~350 MB                            │                          
       │   Alpine + tini + Node 20                  │                          
       │   git, gh, python, ripgrep, jq, build-...  │                          
       │   sandbox-daemon (Hono HTTP RPC)           │                          
       │   raltic CLI (内部, PATH 注入)             │                          
       │                                            │                          
       │  /workspace (R2 卷)                        │                          
       │   ├─ repos/        (GH OAuth clone)        │                          
       │   ├─ notion/       (sync)                  │                          
       │   ├─ linear/       (sync)                  │                          
       │   ├─ uploads/      (频道上传文件)          │                          
       │   ├─ out/          (agent 产出)            │                          
       │   └─ .memory/      (agent 持久 notes)      │                          
       │                                            │                          
       │  sleep-on-idle (5 min no msg → hibernate)  │                          
       └────────────────────────────────────────────┘                          

┌──────────────────────────────────────────────────────────────────────────┐
│                     AI Gateway (CF native)                                │
│  Single binding, routes to:                                               │
│   ├─ Anthropic (Sonnet / Opus / Haiku)                                    │
│   ├─ OpenAI (GPT-5.5 / GPT-5.4 / o-series)                                │
│   ├─ Google (Gemini 2.5 Pro / Flash)                                      │
│   ├─ Workers AI (embeddings only — Free 推理走 Haiku/Flash, 见 D1)        │
│   └─ Anthropic via user-supplied API key (BYO mode)                       │
│                                                                           │
│  Features:                                                                │
│   ├─ Semantic cache (CF edge KV)                                          │
│   ├─ Per-tenant rate limit                                                │
│   ├─ Per-tenant budget cap                                                │
│   ├─ Provider fallback (Anthropic down → OpenAI)                          │
│   ├─ Full trace + per-token billing dashboard                             │
│   └─ Audit log (compliance)                                               │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流（一次 @-mention 的完整路径）

```
1. User 在频道 @raltic-bot "搜一下我们上周关于 onboarding 的讨论"
   └─ Web → POST /messages → ChatRoom DO
                                    │
2. ChatRoom DO 写消息, broadcast WS
                                    │
3. ChatRoom DO 发现 mention 包含 agent → 通过 RPC 调 RalticAgent DO
                                    │
4. RalticAgent DO.onMessage(msg):
   ├─ append to state.history
   ├─ load 最近 50 条消息作为上下文
   └─ 调 AI Gateway → Anthropic (Sonnet)
                                    │
5. Anthropic 流式返回, 第一个 tool_call = search_messages("onboarding", 10)
                                    │
6. RalticAgent DO 调 Vectorize:
   ├─ AI binding: embed query
   ├─ Vectorize.query(embedding, filter: workspaceId, topK: 10)
   └─ 返回 message ids → 从 D1 拉完整内容
                                    │
7. Tool result 喂回 Anthropic → 它生成 reply 文本
                                    │
8. RalticAgent DO 通过 ChatRoom DO RPC post 回频道
                                    │
9. ChatRoom DO 扇出 WS, Web UI 流式渲染
```

**整条路径**：Worker (Hono) → DO (ChatRoom) → DO (RalticAgent) → AI Gateway → DO (Vectorize binding) → DO (ChatRoom) → WS。零外部依赖，零容器调用（因为这次 tool 不需要容器）。

如果 agent 接下来要 `bash_exec("cd repos/my-app && pnpm test")`，第 6 步会变成调 sandbox container 的 RPC。

---

## 4. 详细设计

### 4.1 RalticAgent DO（核心新增）

```ts
// packages/agent/src/raltic-agent.ts
import { Agent } from "agents";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import { z } from "zod";

interface AgentState {
  agentId: string;          // 对应 D1 agents.id
  workspaceId: string;
  ownerId: string;
  runtime: "raltic";        // 区分 cloud-native vs claude-cli vs bridge
  history: ChatMessage[];   // 上下文窗口 (压缩前)
  todoList: TodoItem[];     // plan mode
  workspaceContainerId: string | null;  // 第一次需要 sandbox 时分配
  totalTokensThisMonth: number;
  lastActiveAt: number;
  // 长任务硬超时 (D3): 设置时即任务开始, alarm 巡检超过 plan 上限就 archive 当前
  // turn 并通知用户. null = 当前没有 active 长任务.
  // 上限: Free 5min / Pro 30min / Team 4hr / Enterprise null (无限).
  taskStartedAt: number | null;
}

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolResult?: { id: string; result: unknown };
  tokens?: number;
  ts: number;
}

export class RalticAgent extends Agent<Env, AgentState> {
  initialState: AgentState = {
    agentId: "",
    workspaceId: "",
    ownerId: "",
    runtime: "raltic",
    history: [],
    todoList: [],
    workspaceContainerId: null,
    totalTokensThisMonth: 0,
    lastActiveAt: 0,
  };

  // ── Entry point: 收到 @-mention 或 DM ───────────────────────────────
  async onMessage(message: IncomingMessage): Promise<void> {
    await this.setState({
      ...this.state,
      history: this.compactIfNeeded([...this.state.history, {
        role: "user",
        content: message.text,
        ts: Date.now(),
      }]),
      lastActiveAt: Date.now(),
    });

    // 决定本次需要哪些工具
    const tools = this.buildToolset();

    // 推理 + 多步 tool calling
    const stream = await this.env.AI_GATEWAY.streamText({
      model: this.modelForAgent(),   // "anthropic/claude-sonnet-4-6" via gateway
      tools,
      messages: this.toAnthropicMessages(this.state.history),
      maxSteps: 50,
      system: this.systemPrompt(),
      onToolCall: async (call) => this.dispatchTool(call),
      onTokenUsage: async (u) => this.recordTokens(u),
    });

    // 流式写回 ChatRoom (它扇出 WS)
    let buffer = "";
    for await (const chunk of stream.textStream) {
      buffer += chunk;
      await this.streamToChannel(message.channelId, buffer, /* final */ false);
    }
    await this.streamToChannel(message.channelId, buffer, /* final */ true);

    // 追加到 history
    await this.setState({
      ...this.state,
      history: [...this.state.history, {
        role: "assistant",
        content: buffer,
        ts: Date.now(),
      }],
    });
  }

  // ── 工具集（不同 agent 不一样, 按权限/连接器决定）──────────────────
  private buildToolset() {
    return {
      // ── In-Worker tools ────────────────────────────────────────────
      search_messages: tool({
        description: "Semantic search across this workspace's messages",
        parameters: z.object({ query: z.string(), limit: z.number().default(10) }),
        execute: async ({ query, limit }) => this.searchMessages(query, limit),
      }),
      post_to_channel: tool({ /* ... */ }),
      create_task: tool({ /* ... */ }),
      read_uploaded_file: tool({ /* ... */ }),

      // ── Sandbox RPC tools (按需懒起容器)────────────────────────────
      file_read: tool({
        description: "Read a file from /workspace",
        parameters: z.object({ path: z.string() }),
        execute: async ({ path }) => this.sandboxRPC("file/read", { path }),
      }),
      file_write: tool({ /* ... */ }),
      file_edit: tool({ /* ... */ }),
      bash_exec: tool({ /* ... */ }),
      grep: tool({ /* ... */ }),
      glob: tool({ /* ... */ }),
      git: tool({ /* ... */ }),

      // ── Connector tools (按用户已授权的 connector 动态注入)─────────
      ...this.connectorTools(),
    };
  }

  // ── 容器调度: 第一次需要 sandbox 时分配 ─────────────────────────────
  private async sandboxRPC(path: string, body: unknown): Promise<unknown> {
    if (!this.state.workspaceContainerId) {
      const id = await this.ensureContainer();
      await this.setState({ ...this.state, workspaceContainerId: id });
    }
    const container = this.env.SANDBOX.get(
      this.env.SANDBOX.idFromName(this.state.workspaceContainerId!),
    );
    return container.fetch(`https://sandbox/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.sandboxBearer()}` },
      body: JSON.stringify(body),
    }).then(r => r.json());
  }

  // ── DO Alarm: 定时任务 (e.g. "每天 9am 总结昨天") ─────────────────
  async alarm(): Promise<void> {
    await this.runScheduledTasks();
    // 重新 schedule next alarm
    const next = this.nextScheduledAlarmTime();
    if (next) await this.ctx.storage.setAlarm(next);
  }

  // ── 上下文压缩 ─────────────────────────────────────────────────────
  private compactIfNeeded(history: ChatMessage[]): ChatMessage[] {
    const totalTokens = history.reduce((s, m) => s + (m.tokens ?? 0), 0);
    if (totalTokens < this.modelContextWindow() * 0.7) return history;
    // 用 Haiku 把早期 turn 压缩成 summary
    return this.compactWithHaiku(history);
  }

  // ── 工具实现细节 ───────────────────────────────────────────────────
  private async searchMessages(query: string, limit: number) {
    // SECURITY (D8): workspaceId filter MUST be injected by Worker code, not
    // surfaced as a tool parameter to the LLM. Allowing the model to control
    // the filter would let a compromised prompt leak across workspaces.
    const emb = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", { text: query });
    const matches = await this.env.VECTORIZE.query(emb.data[0], {
      topK: limit,
      filter: { workspaceId: this.state.workspaceId },   // 强制, 非 tool 参数
    });
    const db = drizzle(this.env.DB);
    return db.select().from(messages)
      .where(inArray(messages.id, matches.matches.map(m => m.id)));
  }

  // ... 其余 connector / billing / scheduled task 方法
}
```

**为什么 DO 是天然容器**：

- 一个 Agent → 一个 DO 实例。`idFromName(agentId)` 全局唯一。
- 状态用 `this.state` 或 `this.ctx.storage.sql`，跨 hibernation 自动持久化。无需碰 D1 对 agent-runtime 内部状态。
- `alarm()` 内建定时调度。
- DO 自动 hibernate；下一条消息到来时唤醒。
- 跟现有 ChatRoom DO / UserGateway DO 心智模型一致。

### 4.2 Sandbox Container

```dockerfile
# packages/sandbox-image/Dockerfile
FROM node:20-alpine

# ─── 系统层 ────────────────────────────────────────────────────────────
RUN apk add --no-cache \
    tini git github-cli curl jq ripgrep \
    python3 py3-pip uv \
    bash make g++ \
  && rm -rf /var/cache/apk/*

# ─── sandbox-daemon ───────────────────────────────────────────────────
COPY ./daemon /opt/raltic/daemon
WORKDIR /opt/raltic/daemon
RUN npm ci --omit=dev

# ─── raltic 内部 CLI (raltic-search, raltic-post, ...) ───────────────
COPY ./raltic-cli /opt/raltic/cli
RUN ln -s /opt/raltic/cli/bin/raltic /usr/local/bin/raltic

WORKDIR /workspace
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/opt/raltic/daemon/index.js"]

EXPOSE 8080
```

**daemon API（HTTP RPC, 内网, bearer 鉴权）**：

```
POST /file/read          { path }                      → { content, encoding }
POST /file/write         { path, content }             → { ok, bytes }
POST /file/edit          { path, oldStr, newStr }      → { ok, occurrences }
POST /grep               { pattern, path, opts }       → { matches[] }
POST /glob               { pattern, path }             → { paths[] }
POST /bash/exec          { command, timeout, stream? } → { exitCode, stdout, stderr }
                                                         (stream=true 时走 WS)
POST /bash/stream        (WS)                          ← long-running terminal
POST /git/clone          { url, path, gitToken }       → { ok, sha }
POST /git/commit         { path, message, files }      → { sha }
POST /git/push           { path, gitToken }            → { ok }
POST /workspace/snapshot { reason }                    → { snapshotId }
                                                         (持久化到 R2)
POST /workspace/restore  { snapshotId }                → { ok }
```

**安全模型**：

- 每个 container 实例由对应 RalticAgent DO 独享访问（DO bearer + container ACL）。
- Bearer token 短生命周期（5 分钟），DO 持有签发能力。
- Container 出站网络默认放开（agent 需要 npm install / git pull / curl），但通过 CF egress 策略可按 workspace 限制。
- `/workspace` 是该 agent 唯一可写目录；`/opt` 和系统目录只读。

### 4.3 AI Gateway 配置

```jsonc
// wrangler.jsonc (apps/api 或独立 ai-gateway worker)
{
  "ai_gateway": {
    "binding": "AI_GATEWAY",
    "gateway_id": "raltic-prod",
    "providers": [
      { "type": "anthropic",     "endpoint": "...", "fallback_order": 1 },
      { "type": "openai",        "endpoint": "...", "fallback_order": 2 },
      { "type": "google-ai",     "endpoint": "...", "fallback_order": 3 },
      { "type": "workers-ai",    "fallback_order": 99 }
    ],
    "cache": {
      "enabled": true,
      "ttl_seconds": 3600,                       // D7: 1 小时
      "exclude_high_temperature": 0.3,           // D7: temp >= 0.3 不缓存
      "exclude_models": ["claude-opus-4-7"]      // Opus 永不缓存, 保证新鲜
    },
    "rate_limit": {
      "per_user_per_minute": 60,
      "per_user_per_hour": 1200
    },
    "audit_log": true
  }
}
```

**BYO API key 模式**：

- 用户在 Settings → API Keys 填 Anthropic key (sk-ant-...)。
- 加密存 D1 `user_api_keys` 表（KMS envelope encryption, key 在 Workers Secrets）。
- Agent 调 AI Gateway 时附 `cf-aig-bypass-key: <user_key>`，gateway 用这个 key 转发，不计入我们的额度。
- BYO 模式下我们仍然收 SaaS 费用（$9-29/mo），不抽推理 markup。

### 4.4 Vectorize 索引设计

```
Index name: raltic-messages-prod
Dimensions: 768 (bge-base-en-v1.5)
Metric: cosine

Vector ID = messages.id (UUID)
Metadata:
  workspaceId   (filter key)
  channelId
  senderId
  senderType    (human | agent)
  createdAt     (epoch ms)
  threadParentId? (string | null)
```

**Embedding 管线**：

```
ChatRoom DO  ─ on alarm flush ─→ D1 batch insert messages
                                       │
                                       ▼
                          Queue: "embed-pending"
                                       │
                                       ▼
              Worker (embed-worker, scheduled)
                  for each pending message:
                    text = preprocess(message.content)
                    emb  = AI.run("bge-base-en-v1.5", { text })
                    VECTORIZE.upsert(messageId, emb, metadata)
```

**隔离**：所有查询强制带 `filter: { workspaceId }`。RalticAgent DO 的 `searchMessages` 在 Worker 层加这个 filter，agent 改不了。

### 4.5 Connector 框架（不走 MCP）

```ts
// packages/connectors/src/types.ts
interface Connector {
  id: "github" | "linear" | "notion" | "gdrive" | "slack" | "gmail";
  displayName: string;
  oauthConfig: OAuthConfig;
  syncStrategy: "push" | "pull" | "webhook" | "none";
  tools: ConnectorTool[];
  workspaceMount?: string;   // 同步到 /workspace/<mount>/, 比如 "notion"
}

interface ConnectorTool {
  name: string;              // e.g. "github_create_issue"
  description: string;
  schema: z.ZodTypeAny;
  execute(args: unknown, ctx: ConnectorCtx): Promise<unknown>;
}

interface ConnectorCtx {
  userId: string;
  workspaceId: string;
  accessToken: string;       // 从 D1 connector_tokens 取
  refreshToken?: string;
}
```

**MVP Connector 清单**：

| Connector | tools 示例 | 同步进 /workspace? |
|---|---|---|
| GitHub | `github_search_issues`, `github_create_pr`, `github_clone_repo` | `repos/<name>/` |
| Linear | `linear_list_issues`, `linear_create_issue`, `linear_assign` | `linear/issues.json` |
| Notion | `notion_search`, `notion_read_page`, `notion_create_page` | `notion/<page>.md` (每天 sync) |
| Google Drive | `gdrive_read`, `gdrive_write`, `gdrive_search` | `gdrive/<file>` (on-demand) |
| Slack | `slack_search`, `slack_post`, `slack_thread` | 无 (按需 API) |
| Gmail | `gmail_search`, `gmail_send_draft` | 无 (按需 API) |

**OAuth 流程**：

```
1. Web: Settings → Connectors → "Connect GitHub"
2. → 跳 /oauth/github/start (Worker route)
3. Worker 生成 state + redirect 到 GitHub
4. GitHub callback → /oauth/github/callback
5. Worker 用 code 换 access_token + refresh_token
6. 加密存 D1 connector_tokens (workspaceId, userId, connectorId, ...)
7. → 回 Web, "GitHub connected ✓"
8. RalticAgent DO 下次 buildToolset() 时自动包含 GitHub tools
```

### 4.6 Tool Registry

```ts
// packages/agent/src/tools/registry.ts
export const BUILTIN_TOOLS = {
  // ── Raltic-native ────────────────────────────────────────────
  search_messages,
  post_to_channel,
  create_task,
  update_task,
  read_uploaded_file,
  list_channel_files,
  list_workspace_members,
  schedule_self,           // 让 agent 设自己的 alarm
  
  // ── Sandbox (lazy 起容器) ────────────────────────────────────
  file_read,
  file_write,
  file_edit,
  bash_exec,
  grep,
  glob,
  git_clone,
  git_commit,
  git_push,
  
  // ── Web ─────────────────────────────────────────────────────
  web_fetch,
  web_search,              // 走 Brave / Bing API
};

// + connectors[].tools 动态注入
```

每个 tool 有：

- `description`: 给 LLM 看的说明
- `parameters`: zod schema
- `execute(args, ctx)`: 实现
- `requiresContainer?: boolean`: 决定是否触发 lazy 容器分配
- `costEstimate?: (args) => number`: 用于 budget 控制

### 4.7 Workspace 内容同步

```
                     ┌──────────────────────────┐
                     │  /workspace/             │
                     │                          │
                     │  repos/      ← GitHub    │
                     │  notion/     ← Notion    │
                     │  linear/     ← Linear    │
                     │  gdrive/     ← Drive     │
                     │  uploads/    ← R2 静态   │
                     │  out/        ← Agent 写  │
                     │  .memory/    ← Agent 持久│
                     └────────┬─────────────────┘
                              │ R2 mount (CF Containers
                              │   volume binding)
                              ▼
                     ┌──────────────────────────┐
                     │  R2 bucket: raltic-      │
                     │    workspaces/           │
                     │    <agentId>/...         │
                     └──────────────────────────┘
```

**同步策略 (D5)**：

- **uploads/**: 频道里上传文件直接落 R2 该路径，agent 立刻能看到。
- **notion/, linear/, gdrive/**: 两路并行——webhook 主路径（provider 支持时实时增量）+ 5 min Cron 兜底 (CF Cron `*/5 * * * *`)。具体:
  - GitHub: webhook (push, PR, issue events) 主路径
  - Linear: webhook 主路径
  - Slack: webhook 主路径
  - Notion: 无 webhook，纯 5 min poll
  - Google Drive: change-token poll 5 min (Drive 的 webhook 难配, P3 再考虑)
- **repos/**: 用户点 "import repo" 时 agent 自己跑 `git clone` (sandbox)，之后由 agent 维护 (git pull on demand 或 webhook 通知)。
- **out/, .memory/**: agent 自己写。

**Webhook 处理**：`apps/api/src/routes/webhooks/<provider>.ts`，验签 (HMAC) → 入 Queue → sync worker 增量更新对应 /workspace/ 子目录。失败重试 3 次，过期事件 24h 后丢弃。

---

## 5. 数据模型变更

### 5.1 D1 新增表

```sql
-- 5.1.1 agents 表加 runtime 列扩展
ALTER TABLE agents ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'bridge';
-- 取值: 'raltic' | 'claude' | 'codex' | 'gemini' | 'copilot' | 'bridge'
-- 'bridge' = 现有本地模式; 'raltic' = 新云端原生

-- 5.1.2 用户 API key 保险库 (BYO)
CREATE TABLE user_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,           -- 'anthropic' | 'openai' | 'google'
  encrypted_key BLOB NOT NULL,      -- envelope encrypted
  key_fingerprint TEXT NOT NULL,    -- 前 6 后 4 用于显示
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX ix_user_api_keys_user_provider ON user_api_keys(user_id, provider);

-- 5.1.3 Connector OAuth tokens
CREATE TABLE connector_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,       -- 'github' | 'linear' | ...
  encrypted_access_token BLOB NOT NULL,
  encrypted_refresh_token BLOB,
  scope TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_connector_tokens ON connector_tokens(workspace_id, user_id, connector_id);

-- 5.1.4 计费 / token 用量
CREATE TABLE agent_token_usage (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd_micro INTEGER NOT NULL,    -- 微美元 (1/1M USD), 整数避免浮点
  byo_key BOOLEAN NOT NULL DEFAULT 0,
  bucket_day TEXT NOT NULL,           -- 'YYYY-MM-DD' 用于聚合
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_token_usage_user_day ON agent_token_usage(user_id, bucket_day);
CREATE INDEX ix_token_usage_agent ON agent_token_usage(agent_id, created_at);

-- 5.1.5 计费 plan
CREATE TABLE billing_plans (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL,                 -- 'free' | 'pro' | 'team' | 'enterprise'
  token_quota_monthly INTEGER NOT NULL DEFAULT 0,
  workspace_quota INTEGER NOT NULL DEFAULT 1,
  agent_quota INTEGER NOT NULL DEFAULT 1,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end INTEGER,
  byo_key_allowed BOOLEAN NOT NULL DEFAULT 0,
  cloud_container_allowed BOOLEAN NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
```

### 5.2 RalticAgent DO storage 设计

DO 内 `storage.sql` 表（per-agent 隔离，不去 D1 往返）：

```sql
-- agent 自己的工作记忆 (短期, frequently mutated)
CREATE TABLE memory (
  key TEXT PRIMARY KEY,
  value TEXT,                  -- JSON
  updated_at INTEGER
);

-- 长任务 (跨多 turn 的 plan)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT,                 -- 'pending' | 'in_progress' | 'completed'
  created_at INTEGER,
  completed_at INTEGER
);

-- scheduled jobs (定时任务)
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  cron TEXT,                   -- e.g. "0 9 * * *" (每天 9am)
  prompt TEXT,                 -- 醒来后执行什么
  enabled BOOLEAN DEFAULT 1,
  next_fire_at INTEGER
);
```

D1 vs DO storage 分工：

- **D1**: 跨 agent / 跨用户 / 全局可查的数据（消息、用户、workspace 元信息、计费、connector）
- **DO storage**: per-agent 内部状态（memory、plan、history、schedule）

### 5.3 R2 路径约定

```
raltic-workspaces/
  <agentId>/
    repos/...
    notion/...
    linear/...
    uploads/...
    out/...
    .memory/...
    .raltic/                  ← 内部 (sandbox-daemon 用)
      bearer-tokens.json
      sync-state.json

raltic-snapshots/
  <agentId>/
    <snapshotId>/             ← workspace/snapshot 命令产物
      manifest.json
      files.tar.gz

raltic-uploads/               ← 现有, 不变 (avatars + server-icons)

raltic-backups/               ← 现有
```

---

## 6. API 变更

### 6.1 新 REST endpoints

```
GET    /api/v1/agents/:id/state            (RalticAgent DO state 快照, 给前端 IDE pane)
POST   /api/v1/agents/:id/runtime          { runtime: "raltic" | "bridge" | ... }

GET    /api/v1/agents/:id/workspace        (列 /workspace 顶层目录)
GET    /api/v1/agents/:id/workspace/*      (读单个文件)
POST   /api/v1/agents/:id/workspace/upload (上传文件到 /workspace/uploads/)

POST   /api/v1/connectors/:id/oauth/start  → 302 to provider
GET    /api/v1/connectors/:id/oauth/callback
GET    /api/v1/connectors                  (列已连接)
DELETE /api/v1/connectors/:id

POST   /api/v1/api-keys                    { provider, key }
GET    /api/v1/api-keys                    (列, 只回 fingerprint)
DELETE /api/v1/api-keys/:id

GET    /api/v1/billing/plan
POST   /api/v1/billing/checkout            (Stripe checkout session)
GET    /api/v1/billing/usage               (本月用量)
```

### 6.2 WS 协议扩展

ChatRoom WS 新增帧类型：

```ts
// 服务端 → 客户端
{ v, t: "agent_thinking", agentId, status, label }     // 流式 status
{ v, t: "agent_tool_call", agentId, tool, args }       // tool call 通知
{ v, t: "agent_tool_result", agentId, tool, ok }       // tool 完成
{ v, t: "agent_text_delta", agentId, text }            // 流式文本 (替换语义)
{ v, t: "agent_workspace_change", agentId, path, op }  // /workspace 变化通知

// 客户端 → 服务端  
{ v, t: "agent_interrupt", agentId }                   // 用户中断长任务
```

UserGateway 也加：

```ts
{ v, t: "agent_container_status", agentId, status: "cold"|"warming"|"hot"|"hibernated" }
```

### 6.3 内部 RPC（DO ↔ DO, DO ↔ Container）

```
ChatRoom DO ─→ RalticAgent DO:
  .processMessage(channelMessage)
  .interrupt(reason)
  
RalticAgent DO ─→ ChatRoom DO:
  .postMessage({ text, agentId })
  .postTextDelta(channelId, buffer)
  
RalticAgent DO ─→ SandboxContainer:
  HTTP RPC (见 4.2)
  
RalticAgent DO ─→ AI Gateway:
  HTTP (gateway binding)
```

---

## 7. 产品功能升级

### 7.1 Agent 创建流程（新版）

```
[Step 1] Pick agent type
  ┌────────────────────────────────────────┐
  │  What kind of agent?                   │
  │  ──────────────────────                │
  │  ○ General assistant                   │
  │  ● Code reviewer                       │
  │  ○ Marketing copywriter                │
  │  ○ Customer support triage             │
  │  ○ Blank slate                         │
  └────────────────────────────────────────┘

[Step 2] Connect data sources (optional, skippable)
  ┌────────────────────────────────────────┐
  │  Connect what this agent should know:  │
  │  ──────────────────────────────────    │
  │  [✓] GitHub  → choose repo: my-app     │
  │  [ ] Linear                            │
  │  [ ] Notion                            │
  │  [ ] Google Drive                      │
  └────────────────────────────────────────┘

[Step 3] Where should this agent live?
  ┌────────────────────────────────────────┐
  │  ● Cloud (recommended, zero install)   │
  │  ○ My machine (local bridge)           │
  └────────────────────────────────────────┘

[Step 4] Pick model (or use default)
  ┌────────────────────────────────────────┐
  │  Model:  [Claude Sonnet 4.6 ▾]         │
  │  Free tier uses Haiku.                 │
  └────────────────────────────────────────┘

[Step 5] Create
  └─ "Spinning up your agent..." (实时打勾)
       ✓ Created agent identity
       ✓ Connected GitHub
       ✓ Cloning repo to workspace...
       ✓ Ready
  
  → 自动跳进新 agent 的 DM 频道, agent 主动说 "hi"
```

### 7.2 Workspace IDE pane（Cloud mode 专属）

频道页面右侧新增可折叠面板，展示 agent 的 /workspace：

```
┌────────────────────────────┬─────────────────────────────────┐
│  Channel: #engineering     │  Workspace (code-reviewer)       │
│                            │                                  │
│  alice: @code-reviewer can │  📁 repos/my-app                │
│    you review PR #234?     │   📄 src/auth.ts                │
│                            │   📄 src/db.ts                  │
│  code-reviewer:            │   📄 ...                        │
│   Reading PR #234...       │                                  │
│   Checking auth changes... │  📁 .memory                     │
│   Found 2 issues:          │   📄 review-history.json        │
│   1. Missing input         │                                  │
│      validation on line 45 │  ┌─ Terminal ─────────────────┐ │
│   2. SQL string concat in  │  │ $ gh pr view 234           │ │
│      query, use param      │  │ PR #234: Add password reset │ │
│                            │  │ ...                        │ │
│                            │  └─────────────────────────────┘ │
└────────────────────────────┴─────────────────────────────────┘
```

技术：
- Monaco editor for file view
- xterm.js for terminal stream (走 sandbox-daemon `/bash/stream` WS)
- 实时增量更新（agent 改文件 → workspace_change 帧 → 前端高亮）

### 7.3 Connector Store

Settings → Connectors 是一个"App Store"式页面。每个 connector 卡片：

- 图标 + 名字 + 描述
- 状态: "Not connected" / "Connected as @alice" / "Token expired"
- "Connect" 按钮
- 显示这个 connector 给 agent 增加哪些 tools

### 7.4 计费 / Quota

```
Plan: Free
─────────────
  Token quota:    200K/mo (Haiku-3.5 / Gemini-2.5-Flash only)     ← D1
  Workspaces:     1
  Agents:         2 cloud + unlimited bridge
  Sandbox:        ✓ 512MB, sleep aggressive                       ← D2
  Long task:      max 5 min/turn                                  ← D3
  Connectors:     3
  SSH:            ✗                                                ← D4

Plan: Pro $29/mo
─────────────
  Token quota:    5M/mo (any model up to Sonnet)
  Workspaces:     3
  Agents:         10 cloud + unlimited bridge
  Sandbox:        ✓ 512MB, sleep relaxed                          ← D2
  Long task:      max 30 min/turn                                 ← D3
  Connectors:     unlimited
  BYO key:        ✓ (绕过 token quota)
  SSH:            ✗ (v1) / v2 待评估                              ← D4

Plan: Team $79/seat/mo
─────────────
  Token quota:    20M/mo per seat (any model)
  Workspaces:     unlimited
  Agents:         unlimited
  Sandbox:        ✓ 1GB, 持久 IDE                                  ← D2
  Long task:      max 4 hr/turn                                   ← D3
  Connectors:     unlimited + SSO connectors
  BYO key:        ✓
  SSH:            v2 启用 (Team plan 引入卖点)                    ← D4
  Audit log:      ✓

Plan: Enterprise (Custom)
─────────────
  Token quota:    协议 (建议 100M+/seat)
  Sandbox:        2GB+ 可定制                                      ← D2
  Long task:      无限                                             ← D3
  Vectorize:      可申请物理隔离 index (合规)                       ← D8
  SSH + audit:    ✓
  Workers AI 私有部署: 可协议
```

### 7.5 老用户兼容

- 现有 4 runtime adapter 不动
- agents.runtime_mode 默认 'bridge'，老 agent 一行不改
- 新 agent 创建 wizard 默认 'raltic' (cloud mode)
- 老 agent 可以在 Settings 里"升级到 Cloud"——后端跑迁移：clone bridge workspace 进 R2，重新 attach to RalticAgent DO

---

## 8. 迁移策略

### 8.1 共存期（永久并行）

```
agents.runtime_mode    路由到
─────────────────      ────────
'raltic'               RalticAgent DO + AI Gateway + Sandbox (新)
'claude'               RalticAgent DO + Claude Code sidecar 容器 (P2)
'codex'                同上 + Codex sidecar
'gemini'               同上 + Gemini sidecar
'copilot'              同上 + Copilot sidecar
'bridge'               本地 bridge (现有)
```

**所有路径走同一个 `AgentDispatcher`**，它根据 `runtime_mode` 决定 DO 路由。

### 8.2 数据迁移路径（bridge → raltic）

**单向切换 (D6)**: 不并行，迁移完成后老 bridge 上的该 agent 标 `archived`，不再接受消息。用户可"Move back to Bridge"反向切换，仍是单向。

```
1. 用户 click "Move to Cloud" 按钮 (Agent settings)
2. Web 弹 confirm: "Moving will disable this agent on your local bridge. Continue?"
3. Web → POST /agents/:id/migrate-to-cloud
4. Worker 验证: bridge 必须在线, agent 必须 idle
5. Worker 标记 agents.migration_status = 'in_progress', 老 bridge 立刻停止接收新 message
6. Worker → bridge 发指令: "snapshot workspace + upload to R2"
7. Bridge 跑: tar -czf - /agent-workspace/<agentId>/ | put R2://raltic-migrations/<jobId>
8. Worker 监听 R2 (or webhook): 上传完成 → 创建新 RalticAgent DO
9. RalticAgent DO 起 sandbox, 从 R2 restore 到 /workspace/
10. agents.runtime_mode = 'raltic', agents.migration_status = 'completed'
11. 老 bridge 端 agent.status = 'archived' (DO 通知)
12. 通知用户: "Migration complete. Local bridge agent disabled."
```

**回退路径 (cloud → bridge)** 完全对称, 步骤反过来。同一 agent 同时只活一个 runtime。

**反向也支持**: cloud → bridge (snapshot R2 → download → local restore)。

### 8.3 现有 4 runtime 的位置

P2 阶段把 Claude Code / Codex / Gemini / Copilot CLI 做成**sidecar 容器**（可选挂载），用户选 'claude' runtime 时附加。**默认 raltic 模式不需要任何 AI CLI 预装**。

---

## 9. 分期实施

### Phase 0 — Sandbox + Agent SDK 骨架（3 周）

```
W1:  packages/sandbox-daemon  (Hono + 系统工具 RPC)
     packages/sandbox-image   (Dockerfile + tini + ripgrep + ...)
     CF Containers POC: 起容器 → /file/read 跑通

W2:  pnpm add agents (CF Agents SDK)
     packages/agent/src/raltic-agent.ts: extends Agent
     最小 state + onMessage + 3 个 in-Worker tools
     AI Gateway 配置 (一个 provider 即可: Anthropic)
     单测覆盖 DO state 转换

W3:  ChatRoom DO 集成: @mention agent → 触发 RalticAgent DO
     一个 'raltic' runtime 的 agent 端到端跑通 (无 sandbox)
     验收: PM 类用户问"过去 7 天发了什么", agent 用 search_messages
           工具回答, 全程云端
```

### Phase 1 — Full Raltic Agent（4 周）

```
W4:  Sandbox 集成: RalticAgent.sandboxRPC → CF Container
     lazy 容器分配 + sleep 调度
     workspace R2 挂载验证

W5:  完整 tool 集: file_*, bash_exec, grep, glob, git_*
     长任务 / plan mode (DO storage schedule 表)
     Compaction 策略 (Haiku 压缩老 turn)

W6:  Workspace IDE pane (Monaco + xterm.js)
     workspace_change WS 帧 + 前端高亮

W7:  Agent 创建 wizard 改版, 默认 cloud mode
     验收: Engineer 类用户全程云端建 agent, clone repo, 让它改代码 push
```

### Phase 2 — Connectors（4 周）

```
W8:  Connector framework (OAuth + token vault + ConnectorHub Worker)
     GitHub connector + tools

W9:  Notion connector + 后台 sync worker (5 min 拉)
     Linear connector

W10: Google Drive + Slack connector
     Workspace 内容同步 (notion/*.md, linear/*.json) 进 sandbox

W11: Connector Store UI
     权限模型 (per-agent 哪些 connector 可见)
     验收: PM agent 通过 Notion + Linear connector 写一份跨产品周报
```

### Phase 3 — Vectorize + 高级（3 周）

```
W12: Vectorize index + embedding pipeline (Queue + Cron)
     Backfill 现有 D1 messages

W13: search_messages 切到 Vectorize
     AutoRAG over /workspace/uploads (PDF / DOCX 全文)

W14: 子 agent (RalticAgent 调用另一个 RalticAgent)
     Sub-agent UI: 显示 agent 在等子任务
```

### Phase 4 — 计费 + Tier（2 周）

```
W15: Token usage tracking + AI Gateway 计量集成
     billing_plans 表 + Stripe webhook
     Free/Pro/Team quota enforcement
     BYO API key 流程 + 加密 vault

W16: 升级/降级 UI + 计费 dashboard
     发布灰度: 10% 用户走新创建 wizard
```

### Phase 5+ — 优化 + 扩展

```
- Container cold start 优化 (pool / pre-warm)
- 跨 agent 协作 (multi-agent workflow)
- Sidecar runtime: Claude Code / Codex / Gemini / Copilot 作为可选
- Mobile 优化 (Connector-only mode)
- Enterprise: SSO, audit log, custom connector
```

---

## 10. 风险与对策

### 10.1 技术风险

| 风险 | 严重度 | 对策 |
|---|---|---|
| CF Agents SDK 尚新, 文档/示例少 | M | 现成 examples + 我们自己写 minimal repro 验证关键 API |
| CF Containers cold start > 5s 影响 UX | H | image 尽量小 (350MB target); pool 一组预热的 blank container; 显示 "warming..." 状态 |
| Sandbox 安全: agent 容器逃逸 | H | Container 默认沙盒+ tini PID 1; egress 走 CF Network policy; bearer token 短期; 不开特权 |
| AI Gateway provider down | M | 内建 fallback; D1 记录"agent 任务失败"可后台重试 |
| Vectorize cost (embedding 量) | M | 限频, 只 embed > 50 字消息; Workers AI embedding (免费) 优先 |
| BYO key 泄漏 (D1 加密被脱库) | H | envelope encryption: key 在 Workers Secrets, ciphertext 在 D1, secret 轮换不影响数据 |
| DO storage hot key (单 agent 写爆) | L | DO 自带 100K op/s 容量, 一个 agent 用不到 |
| R2 workspace 大小爆炸 | M | per-agent quota (Free 1GB, Pro 10GB, Team 100GB); 自动 prune /workspace/.cache |

### 10.2 产品风险

| 风险 | 严重度 | 对策 |
|---|---|---|
| 老 bridge 用户感到被边缘化 | M | 文档明确: bridge 永久支持; 给 power-user "Local Bridge" badge |
| Cloud agent 跑不动 "重型" 任务 (大 monorepo) | M | Container 可指定 1GB/2GB/4GB tier; Team plan 默认 2GB |
| 用户怕代码上云 | H | 明确文档: workspace 加密、单租户隔离、SOC 2 (后续); 提供 BYO Anthropic key + 本地 bridge 双重 opt-out |
| 计费复杂度劝退 | M | Free 不要 credit card; usage dashboard 透明; "你还剩 X 个 Sonnet turn" 简单话术 |
| Connector 越加越多, UI 混乱 | L | Connector store 按 category 分; 每个 agent 只能看到 owner 配的 |

### 10.3 商业风险

| 风险 | 严重度 | 对策 |
|---|---|---|
| Anthropic / OpenAI 限制平台代用户调 API | H | BYO key 模式作为兜底; OpenCode + Workers AI (Llama) 作为开源 fallback runtime |
| CF Containers 价格上调 | M | 跟 Fly Machines 保持架构对等, 切换路径明确 |
| 推理成本 > 订阅价 | M | Free tier 强制 Haiku/Gemini Flash; Pro 上 Sonnet 但 cap quota; 长任务弹 modal 提示 quota |

---

## 11. 成本模型

### 11.1 单 Agent 成本拆解（活跃用户, Pro plan 假设）

```
项目                                   单位成本           月活预估       小计

CF Container (1GB, ~15% 活跃)         $0.000007/s/MB    ~108 hr active  ~$10
R2 (5GB workspace + IO)               $0.015/GB/mo      5GB             ~$0.08
D1 reads (D1 messages, etc)           $0.0001/read      ~200K reads     ~$0.02
DO requests + storage (RalticAgent)   见 CF pricing                     ~$1
Vectorize queries                     $0.04/M vector queries           ~$0.10
AI Gateway requests                   $0.20/M requests                  ~$0.50

(模型推理, Sonnet, 2M tokens/mo)      $3 input / $15 output            ~$12-25
                                                                       ─────────
                                                                       ~$24-37 / agent / mo
```

### 11.2 Tier 毛利

```
Tier            售价        Agent 数    典型成本/用户                毛利
─────           ─────       ────────    ──────────────────────       ──────
Free            $0          2 agents    ~$1-3 (Haiku/Flash, D1)      亏 $1-3 (获客)
Pro             $29         ~5 active   ~$10-15 (Haiku/Sonnet mix)   ~50%
Pro BYO         $19         ~5          ~$1-3 (推理由用户付)         85%+
Team            $79/seat    ~3 / seat   ~$25-35                      ~55-65%
Enterprise      Custom      —           协议                          —
Local Bridge    免费        unlim       $0 (用户本机)                持平 (留住生态)
```

**Free 成本敏感性 (D1 决定后必须守的红线)**:
- 200K tokens/mo cap 是硬卡, AI Gateway budget enforcement 必须 P4 前上线
- 用户活跃但不付费 > 60 天 → 自动 archive container (workspace 留 R2)
- Haiku-only 模式可加 "burst 到 Sonnet" 按次付费 (e.g. $0.50/30min 体验), 提高 Pro 转化

**目标**: Pro 用户 ARR / 推理 cost 比 > 2.5x. 通过 Haiku 压缩 + 缓存 (D7) + 限频做到。

---

## 12. 成功指标

### 12.1 北极星

**Time-to-first-agent-value (TTFV)**: 从注册到 agent 产出第一个有价值产出（消息回复 / 文件 / 报告）的时间。

```
Today (bridge):        ~10-30 分钟
Target (Cloud Agent):  <90 秒
```

### 12.2 阶段性 KPI

```
P0 完成:
  - 端到端云端 agent 跑通, 内部 dogfood
  - 容器 cold start p50 < 3s, p99 < 8s

P1 完成:
  - 1 个云端 agent 完成"clone repo + 跑测试 + 写文件 + push" 真实任务
  - 工程师内部用户 NPS > 30

P2 完成:
  - 5 个 connector 上线, 每个 connector activation > 50% (新 agent 中)
  - PM/Designer 类用户首次产出率 > 60%

P3 完成:
  - Vectorize 搜索 vs 关键字搜索: 用户偏好率 > 70%

P4 完成:
  - Cloud agent 占新建 agent 比 > 80%
  - Pro 转化率: Free → Pro 7d > 5%
  - Bridge 用户 retention 无下跌
```

---

## 13. 决策日志

闭环时间: 2026-05-20.

### D1. Free tier 推理后端

**Decision**: Haiku (Anthropic) + Gemini Flash (Google) 作为 Free 默认；**不**走 Workers AI Llama。
**Rationale**: Llama 在 agent 多步 tool calling 上能力差一截，免费用户体验断崖会拉低产品口碑。宁可单 Free 用户成本 $1-3/月，也要保证产品调性一致。
**Implications**:
- Free quota 必须严守: **200K tokens/月硬上限**，超出后 agent 拒绝响应并提示升级。
- Free 用户启动模型选择强制锁在 Haiku-3.5 / Gemini-2.5-Flash 之间。
- 推理 cost 进 §11 算 Free tier 月获客成本 (LTV 模型不变, 但 P4 quota enforcement 必须先于公测上线)。

### D2. Sandbox 容器内存档位

**Decision**: 512MB (Free + Pro) / 1GB (Team) / 2GB+ (Enterprise).
**Rationale**: 多数 agent 任务 (Node + git + python 小项目) 512MB 足够；大 monorepo 才需要 1GB+。从最小档起步控成本，按需升档。
**Implications**:
- Dockerfile + CF Container binding 在 wrangler 里按 plan 选 size。
- Workspace 文件可以远大于内存 (R2 卷)，内存档位只影响 build / test 跑得动的项目大小。
- §4.2 Dockerfile 不变，运行时通过 `containers.size` 参数指定。

### D3. Agent 长任务最长时长

**Decision**: Free 5min / Pro 30min / Team 4hr / Enterprise 无限。
**Rationale**: 对齐 Devin/Replit Agent 业界基线。Free 5min 防滥用，Pro 30min 覆盖 95% 真实工程任务，Team 4hr 给"夜里跑大重构"留空间。
**Implications**:
- `RalticAgent.onMessage` 内置 wall-clock timeout，超时发送 `agent_text_delta` 提示并 archive 任务。
- 长任务超时不算"失败"，是"暂停"——用户回来可以续 turn。
- §4.1 RalticAgent DO state 增 `taskStartedAt` 字段，alarm 里检查。

### D4. Cloud workspace SSH 访问

**Decision**: v1 不开 SSH；v2 (Team plan) 加。
**Rationale**: v1 攻击面要小，权限模型要先稳。Web IDE pane (Monaco + xterm.js) 满足 95% 交互需求；SSH 是企业付费理由再加。
**Implications**:
- v1 不需要做 SSH key 管理 / port forwarding / firewall 策略。
- v2 之前若 Enterprise 客户要 SSH，走"我们代开 1 个 bastion + audit log"协议路径，不是 self-serve。

### D5. Connector 同步频率

**Decision**: 5 分钟轮询 + webhook 优先（webhook 可用即走 webhook）。
**Rationale**: PM 用户对 "我刚改的 Notion 文档 agent 看到没" 的延迟敏感。5min poll 是 fallback，webhook 路径几乎实时。
**Implications**:
- Sync Worker (§4.7) 配 CF Cron `*/5 * * * *`。
- Webhook 路由放 `apps/api/src/routes/webhooks/<provider>.ts`，校验签名后入 Queue 触发增量 sync。
- Notion (v1 API 无 webhook) → 只能 5min poll；Linear/GitHub/Slack → webhook 主路径。

### D6. Bridge ↔ Cloud agent 并行

**Decision**: 不允许并行。`agents.runtime_mode` 单选，互斥。
**Rationale**: 双向 workspace 同步 (Dropbox-style) 调试 + 冲突解决巨复杂，v1 不投入。
**Implications**:
- 迁移路径 (§8.2) 是单向切换，切完原 runtime 标 'archived'。
- UI 提示明确："Moving to Cloud will disable this agent on your local bridge."
- 用户后悔可"Move back to Bridge"，仍是单向切换。

### D7. AI Gateway 缓存 TTL

**Decision**: 1 小时 TTL，仅 `temperature < 0.3` 的请求 cache。
**Rationale**: 高 temp 请求 cache 会导致 agent 多次交互返回同一句话（不可接受退化）；低 temp 多是工具决策/格式化，幂等性高，缓存命中 ROI 大。
**Implications**:
- AI Gateway 配置 `cache.exclude_high_temperature: 0.3` (§4.3 配置示例已含)。
- 实测后可按 provider 单独调（Opus 永不 cache，Haiku 可放宽到 4hr）。

### D8. Vectorize 索引策略

**Decision**: 单 global index + `workspaceId` metadata filter。
**Rationale**: CF 官方推荐；运维成本最低；workspace 隔离由 Worker 层强制注入 filter 保证（agent 改不到 query 构造）。
**Implications**:
- §4.4 索引名固定 `raltic-messages-prod` 一个。
- `RalticAgent.searchMessages` 必须由 Worker 代码注入 `filter: { workspaceId: this.state.workspaceId }`，**严禁**把 filter 作为 tool 参数暴露给 LLM。
- 渗透测试用例必加: "诱导 agent 不带 filter 查询" 应失败。
- Enterprise 后续若需物理隔离 (合规)，再迁移成 Hybrid 模式 (§13.D8 备选项)。

---

## 14. 附录

### 14.1 关键依赖版本

```
agents                  ^0.5.x   (CF Agents SDK)
@cloudflare/workers-types  4.x
hono                    4.x
drizzle-orm             0.31.x
zod                     3.x
```

### 14.2 相关文档

- `docs/CLOUDFLARE_MIGRATION.md` — 当前 CF 迁移历史
- `docs/MULTI_RUNTIME_CLAUDE_CODEX.md` — 当前 4 runtime 设计
- `AGENTS.md` — 项目总览

### 14.3 术语表

- **Agent**: Raltic 平台上的一个 AI 实体, 有身份、频道、DM
- **Runtime**: Agent 的执行后端 ('raltic' | 'claude' | 'codex' | 'gemini' | 'copilot' | 'bridge')
- **RalticAgent DO**: CF Agents SDK 提供的 DO 基类的具体实现, agent 的"脑"
- **Sandbox**: per-agent 的容器, agent 的"手"
- **Workspace**: agent 的持久文件系统 (/workspace 在 sandbox, 落 R2)
- **Connector**: 把外部 SaaS (GitHub/Notion/...) 通过 OAuth + tool 暴露给 agent
- **Tool**: agent 可调用的能力 (file_read / bash_exec / github_create_issue / ...)
- **AI Gateway**: CF 的统一 LLM 网关

---

End of v1 draft. Comments / decisions welcome.
