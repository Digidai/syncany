# Raltic → Cloudflare 迁移决策日志

> 当前状态：**历史迁移日志**。Cloudflare 迁移已上线；当前部署、
> 测试和运维说明以 `README.md`、`AGENTS.md`、`docs/SELF_HOSTING.md`
> 和 `docs/OPS.md` 为准。

> 状态：**进行中**（A0 阶段：基础设施 + 技术规划）
> 决策日期：2026-05-08
> 选定方案：**A — 完全 Cloudflare Native 重写**

---

## 为什么选方案 A

Raltic 当前状态：刚 fork 自 EryouHao/zano、零用户、零生产数据、单人维护、未正式上线。

在「无存量」前提下，方案 A 的工作量从「迁移」（11 人周）降到「重写」（4-6 人周），且能一次性解决项目固有的 P0 问题：

| 项目固有问题 | 方案 C 是否解决 | 方案 A 是否解决 |
|---|---|---|
| RLS `WITH CHECK (true)` 漏洞（`fix-rls.sql:20`） | ❌ 原样保留 | ✅ 重写为应用层授权 + 单测 |
| Bridge `bypassPermissions` 沙箱缺失 | ❌ | ⚠️ 仍需单独修（与 CF 无关） |
| 6 个 SQL 手动 paste，无 migration | ❌ | ✅ wrangler d1 migrations |
| 零自动化测试 | ❌ | ✅ 强制随重写补 |
| 无 rate limiting | ❌ | ✅ Workers Rate Limiting binding |
| 无成本追踪 | ❌ | ⚠️ 单独做（与 CF 无关） |

C 方案只把部署平台从 Vercel 换到 Cloudflare Pages，不解决任何上述问题。A 借重写之机一次性补齐工程基线。

---

## 目标技术栈

> 详细选型由后台技术规划生成，本节先列骨架，待报告回来后填充。

| 层 | 当前 | 目标（方案 A） |
|---|---|---|
| Web 部署 | （未部署，预期 Vercel） | Cloudflare Pages + `@opennextjs/cloudflare` |
| 数据库 | Supabase Postgres | **Cloudflare D1**（SQLite） |
| ORM | 裸 SQL + supabase-js | **Drizzle ORM** |
| Realtime | Supabase Realtime | **Durable Objects + WebSocket Hibernation** |
| Auth | Supabase Auth | **better-auth + D1 adapter** |
| API | Next.js Route Handlers | Hono on Workers + Next Route Handlers（混合） |
| 文件存储 | （未用） | R2（如未来需要） |
| Secrets | Vercel env | `wrangler secret put` |
| Migration | 6 个 SQL 手动 paste | `wrangler d1 migrations` |
| Rate limit | 无 | Workers Rate Limiting binding |
| Bridge 位置 | 用户本地（保持不变） | 用户本地，但走 CF WS 协议 |

---

## 待重写代码盘点（2026-05-08 inventory）

```
24 个文件含 Supabase 调用：
  16 处 supabase.from()      — 表 CRUD
   4 处 supabase.channel()   — Realtime（messages, sidebar, agent-activity, bridge-rpc）
  28 处 supabase.auth.*      — 认证（含 SSR cookie）
```

### 调用点分布（24 文件）

**Web 端（17 文件）**
- `lib/supabase/{admin,client,middleware,server}.ts` — 4 个 client 工厂
- `app/(auth)/{login,signup}/page.tsx` — 2 个登录注册页
- `app/api/auth/callback/route.ts` — OAuth 回调
- `app/api/bridge/keys/route.ts` — 机器密钥管理
- `app/api/agents/{[id]/{reset,workspace},route}/route.ts`、`api/agents/[id]/route.ts`
- `app/api/channels/route.ts`、`api/servers/route.ts`
- `app/(chat)/page.tsx`、`app/s/[slug]/layout.tsx`、`app/onboarding/page.tsx`
- `components/{message-area,sidebar,agent-settings-panel,create-agent-dialog,create-channel-dialog,edit-channel-dialog}.tsx`
- `hooks/use-agent-activity.ts`

**Bridge 端（3 文件）**
- `apps/bridge/src/{bridge,chat-bridge,agent-manager}.ts`

**CLI 端（1 文件）**
- `packages/cli/src/index.ts` — 整个 920 行 CLI

**DB 包（1 文件）**
- `packages/db/src/client.ts` — 待删除，由 Drizzle 替代

---

## 项目结构变化（计划）

```
raltic/
├── apps/
│   ├── web/                      # Next.js 16，UI 组件复用，data layer 改写
│   ├── api/         (新增)       # Hono Workers，承载 REST API + WS gateway
│   └── bridge/                   # 本地 Node 守护，data layer 改写
├── packages/
│   ├── db/                       # 内容替换：Drizzle schema + migrations
│   ├── chat-room/   (新增)       # Durable Object：每 channel 一个
│   ├── auth/        (新增)       # better-auth 配置 + 帮助函数
│   ├── protocol/    (新增)       # 跨端协议：zod schema + WS message types
│   ├── cli/                      # 调用方式从 supabase REST → fetch api/
│   └── shared/                   # 保留通用类型，逐步迁入 protocol/
└── docs/
    └── CLOUDFLARE_MIGRATION.md   # 本文档
```

---

## 路线图（4-6 周，1 人全职）

> 每个阶段都是「可暂停退出点」——任何阶段完成后项目都仍可运行。

| 阶段 | 周期 | 交付物 | 退出点说明 |
|---|---|---|---|
| **A0：基线 + PoC** ✅ | 当前周 | wrangler 配置、Drizzle schema 第一稿、ChatRoom DO 骨架、决策日志 | 即使停在这里，schema 文档化是有价值的 |
| **A1：Auth 切换** | 1 周 | better-auth on D1、注册/登录/OAuth 跑通、middleware 集成、onboarding hook | 单独可用 |
| **A2：D1 数据层** | 2 周 | 所有 16 个 `from()` 替换为 Drizzle、授权矩阵 spec + 30+ 单测、API routes 重写 | 数据层可独立工作 |
| **A3：Realtime（DO）** | 1.5 周 | 4 个 `channel()` 用法迁到 ChatRoom DO、Web 客户端切换 | 需配合 A2 |
| **A4：Bridge 重写** | 1 周 | bridge + CLI 数据访问层切换到新 API + DO ws | 最后一块 |
| **A5：上线** | 0.5 周 | 部署到 Cloudflare、烟测、删 Supabase 代码 | — |

### A0 完成清单（2026-05-08）

**基础设施已 provision**：
- D1: `raltic-staging` `8270b74b-13cb-4928-a0c3-f077ce52d1fe` (APAC/SIN)
- KV: `raltic-rate-limits` `5e0ef6f92b35449db0f76d80a69d9548`

**新代码已落地（commit `e1b2699`）**：
- `packages/db/` — Drizzle schema (12 表 / 24 索引 / 13 FK) + 生成的 0000_initial.sql migration
- `packages/protocol/` — 共享 zod schema (WS + REST)，作为 web/bridge/cli/api/DO 间唯一真相
- `packages/chat-room/` — ChatRoom + UserGateway 两个 SQLite-backed DO，含 Hibernation API、auto ping/pong、alarm 驱动 D1 sync、HMAC token 校验
- `packages/auth-core/` — better-auth + onboarding hook（替代原 PG trigger）+ 完整 TypeScript 授权矩阵 (`policy.ts`，替代每条 RLS policy)
- `apps/api/` — Hono Worker：`/api/auth/*` better-auth 全代理、`/api/v1/*` CRUD、`/ws/channel/:id` 与 `/ws/user/:userId` 升级路由

**已 verified**：
- ✅ pnpm typecheck：5 个新 package 全部 clean
- ✅ wrangler d1 migrations apply：50 SQL 命令 / 12 表创建于远程 D1
- ✅ wrangler deploy --dry-run：2.38 MB / 391 KB gzipped，所有 bindings 解析成功

**A1 启动需要的 prerequisites**（用户操作）：
- `wrangler secret put BETTER_AUTH_SECRET --name raltic-api`
- `wrangler secret put CHAT_ROOM_AUTH_SECRET --name raltic-api`
- `wrangler secret put MACHINE_KEY_PEPPER --name raltic-api`
- 邮件走 Cloudflare Email Sending binding（apps/web/wrangler.jsonc 的 `send_email`），无 secret；需在 dashboard → Email → Domains 验证发件域
- 可选：`GOOGLE_CLIENT_ID` / `BETTER_AUTH_GOOGLE_CLIENT_SECRET`、GitHub 同理

---

## 已知风险红线（务必避开）

1. **D1 单库单线程**：当前规模不会撞，未来按 server 分库
2. **DO Hibernation × setInterval 冲突**：bridge 心跳必须改 DO Alarms
3. **bcrypt → argon2id 不可离线 rehash**：零用户期完成，避开此坑
4. **DO location-pinned**：用 `locationHint` 控制 region
5. **Tiptap 必须 client-only**：迁前 grep 所有 `"use client"` 标注
6. **`session` 必须 secure cookie**：CF Workers 没有自动 https 上下文加 secure，需手工

更多坑由后台技术规划补充。

---

## 决策记录

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-05-08 | 选方案 A 而非 C | 项目零用户，A 反而比 C 划算（无迁移成本，强制补齐工程基线） |
| 2026-05-08 | bridge 不上 CF | bridge 本质是本地 Claude Code 子进程托管，与 CF 模型不兼容；这是产品定位约束 |
| 2026-05-08 | 暂时不发 npm 包 | `@raltic/bridge`、`@raltic/cli` 等待 v1.0 再发 |

---

## 待补章节（等后台技术规划报告）

- [ ] 完整 Drizzle schema（替代 5 个 SQL 文件）
- [ ] 授权矩阵 spec（含每条原 RLS policy 的 TS 等价实现）
- [ ] ChatRoom DO 完整代码骨架
- [ ] better-auth 配置示例
- [ ] Bridge 客户端协议规范
- [ ] 周级路线图细化（A1-A5 每周交付物精确到文件）
