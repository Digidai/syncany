# Invite → Signup → Onboarding → Default-Workspace 重设计 (v1, for review)

## 0. 现状与已确认 bug

### 0.1 数据(2026-05-19,Olivia 的实际状态)

| 字段 | 值 |
|---|---|
| Olivia user_id | `at7xBcoP7zom5um18da5XFr8F1eife8C` |
| Olivia 自己 workspace | `06226c59-...` (`olivia-06226c`) — auto-created by `runOnboarding`,owner=Olivia |
| Olivia 加入的 workspace | `af73d122-...` (`gene-af73d1`) — owner=Gene,Olivia=member |
| Olivia 名下的 machine keys (2 把) | **都是 `server_id=af73d122` (Gene's)**,无任何一把绑她自己 workspace |
| Olivia 自己 workspace 的 `Onboarding Assistant` agent | `status=offline`,从 12:39 注册到现在没上线过 |

### 0.2 流程链(实证)

```
Gene 通过 /api/v1/invites/email 发 invite
  ↓ 邮件 → Olivia 点链接
/invite/[id]          (未登录态)
  ↓ "Create account" → /signup?next=/invite/[id]
better-auth signUp.email + email 验证
  ↓ user.create.after hook → runOnboarding(env, newUser)
    创建 ${newUser.name}'s Workspace + Onboarding Assistant + 2 channels + 欢迎消息
  ↓ verifyCallback = /verify-email?next=/invite/[id]
verify-email 自动登录 → router.replace(/invite/[id])
  ↓ /invite/[id] 显示 "Accept invite",Olivia 点
POST /api/v1/invites/:id/accept → server_members 插入 (af73d122, Olivia, role=member)
  ↓ router.push(`/s/${res.serverSlug}`)  ← 落地 Gene's workspace
/s/gene-af73d1
  ↓ me.hasConnectedBridge (user-global) = false → wizard 弹出
  ↓ wizard.serverId = Gene's serverId
  ↓ Olivia 在 wizard 走完,POST /api/v1/machine-keys serverId=Gene's
  ↓ 拿到的 ck_xxx key 绑在 Gene's workspace
  ↓ bridge 起来,连进 Gene's workspace 的 ChatRoom DO
最终:Gene's workspace 看到 Olivia 的 agents online (e.g. `claudia`),
     Olivia 自己 workspace 的 Onboarding Assistant 永远 offline,
     Olivia 在自己 workspace DM agent 没人回。
```

### 0.3 根因清单

| # | 问题 | 位置 |
|---|---|---|
| R1 | Wizard `serverId` = 当前看到的 workspace,而不是用户自己 owned 的 workspace | `apps/web/src/app/s/[slug]/page.tsx:146` |
| R2 | invite-accept 后 `router.push(/s/{invited})` 直接落到邀请方 workspace,首次用户没机会路过自己 workspace | `apps/web/src/app/invite/[id]/page.tsx:45` |
| R3 | `hasConnectedBridge` 是 user-global,不是 per-workspace,误判"她已经有 bridge"或"她没 bridge" | `apps/api/src/routes/me.ts` *(上一轮已修)* |
| R4 | machine_keys 一把绑一个 workspace,bridge 一次只能服务一个 workspace,被邀请者需要 N 把 key、N 个 bridge | schema + `apps/api/src/routes/bridge.ts:30` |
| R5 | 没有"默认 workspace"概念,登录后/重访后总是停在 marketing `/`,workspace 切换全靠 sidebar | (无) |
| R6 | invite 邮件不提她会自动有一个"自己的 workspace",造成模型混乱 | `apps/api/src/routes/invites.ts:138` |
| R7 | sidebar workspace switcher 不显眼,新用户不知道有自己的 workspace 在那 | `apps/web/src/components/workspace-switcher.tsx` |
| R8 | onboarding 消息(Onboarding Assistant 的开场白)是 hardcoded 英文,且没区分 "你被人拉进来" vs "你单飞注册" | `packages/auth-core/src/onboarding.ts:23` |

R1+R2 是直接 P0 — 不修 100% 复现 Olivia 的窘境。R3 已修。R4 是结构问题,Phase 2 处理。R5-R8 是 UX 完善,Phase 1 内顺手解决。

---

## 1. 设计目标(成功标准)

被邀请用户从点邮件链接到第一次跟 agent 对上话,**0 个 dead-end、0 个 wrong workspace、0 个隐藏知识**。具体可验证:

- **G1**:Olivia 接受 invite 后,落到的 workspace 上点任何 agent 都能即刻 DM 上回应(她自己 owned 的 agent + 她在被邀 workspace 的 agent 都是)。
- **G2**:Olivia 任何时候不需要懂"machine key 绑 server" / "bridge 服务一个 workspace" 这种内部模型,产品自己把对应关系处理好。
- **G3**:任何一个 workspace 的 wizard,只会在**真的需要**(她在那里有 agent 但还没 bridge)时弹,弹了就给出**正确的 key**。
- **G4**:她随时知道"自己有哪些 workspace,谁是 owner,我的 home 是哪个",不需要点 dropdown 才能知道。
- **G5**:邀请方(Gene)的视角不变,他不被被邀请者的 onboarding 状态污染。
- **G6**:邀请邮件的预期管理诚实(不夸大、不隐藏副作用)。

---

## 2. 关键决策(标 D)+ 备选权衡

### D1. invite-accept 落地 workspace

| 选项 | 落地 | UX | 风险 |
|---|---|---|---|
| **A. 落到 invited workspace** (Slack/Notion 范式) | `/s/{invited}` | 用户期待:我被邀来这个 workspace,就到这个 workspace | wizard 如果还按"当前 workspace"配 key,继续踩 R1 |
| B. 落到自己 workspace,带 toast "已加入 X" | `/s/{own}` (toast 跳到 X) | 强调 "this is your home" | 反预期:用户来这是为了进 X 不是 home |
| C. 落到 invited workspace,但首屏 banner 引导先去自己 workspace 配 bridge | `/s/{invited}` + banner | 解决"她要在哪 onboard" 同时尊重预期 | banner 容易被忽略 |

**选 A** — 跟主流产品对齐,符合预期。配套必须做的:**wizard 只在用户 owned 的 workspace 上弹,且 serverId 永远是 owned workspace 的**(D2)。在 invited workspace 显示 "Your bridge connects to your own workspace — agents you create here come online when it's running",链接到自己 workspace。

### D2. Wizard pin 到哪个 workspace

| 选项 | 行为 |
|---|---|
| **A. 永远 pin 到用户 owned 的 workspace**(第一个 role=owner 的) | wizard 在任意页面弹时,`serverId = ownedServers[0].id`;copy 改成 "Set up bridge for your workspace `<name>`" |
| B. 让用户在 wizard 第 1 步选择 workspace(下拉) | 更显式,但增加一步 |
| C. 当前 workspace(现状) | bug 之源 |

**选 A** — 用户的"workspace 之家"只有一个(personal workspace),wizard 永远指向那一个。如果用户有多个 owned workspace(极少),取最早创建的;后续在 Account settings 让他选 default。在 invited workspace 上**不弹 wizard**,改成顶部 banner "Set up your bridge from `<Your Workspace>`"(只在用户没 bridge 时显示)。

### D3. Bridge 多 workspace 支持(P2 雏形,P1 不实装)

| 选项 | 行为 |
|---|---|
| **A. P1 不动,one-bridge-one-key-one-workspace** | bridge 用户运行多个进程或换 key 切 workspace |
| B. P1 改 bridge config 支持 keys 数组,一个进程持多 key 多 workspace | 改 bridge.ts + bridge connect 增加批量接口,工作量大 |
| C. P1 直接把 machine_keys 变成 user-scoped,一把 key 服务所有 workspace | 安全降级(一把 key 泄露 = 全 workspace 失守),违反现有 SECURITY 注释 |

**选 A,但 P1 完成 R1/R2 后**,**bridge 已运行时如果用户被邀进新 workspace**,在新 workspace 的页面显示提示:"To bring agents online here, add this workspace to your bridge" → 一键复制 `raltic bridge add-key ck_xxx` 命令(P2 实现)。P1 用户被邀进新 workspace 时,如果他自己没有 agent 在那个 workspace,**不需要任何 bridge 配置** — 普通聊天用户。这是 80% 场景。

### D4. 默认 workspace

| 选项 | 行为 |
|---|---|
| **A. 新增 `users.default_server_id` 字段,登录后 `/` 自动跳转** | 显式;用户可在 Account settings 改 |
| B. 用 cookie 记最后一次访问的 workspace | 隐式;新设备/隐私模式失效 |
| C. 永远跳 owned[0] | 强加,不够灵活 |

**选 A + 兜底 B**。优先级:`default_server_id` > 最后访问的 slug (cookie) > owned[0] > invited[0]。新注册:设为 owned[0](她自己 workspace)。Invite-accept:**不**改 default,落地一次但 default 还是 owned。

### D5. 邀请邮件 + invite 页面 copy

加一句:**"Accepting will create a personal Raltic workspace for you (free) and add you to `<Workspace>`."**。invite 预览页同样补一段 "You'll also get your own private Raltic workspace — switch from the top-left in the sidebar."。

### D6. Onboarding Assistant 开场白

按入口区分:
- 单飞注册:今天的英文文案 + 弹 wizard。
- Invite 注册:开场白改成 "Welcome — Gene invited you to `<Workspace>`. You're already in. This is your own private workspace. I'll show you around when you need; for now, head to `<Workspace>` (top-left sidebar)." 不弹 wizard 直到她需要建 agent。

### D7. Sidebar workspace switcher 默认状态

加视觉提示:
- 顶部 chip "owner" / "member" 角色徽章
- 列表顶端标 "Your workspace" 分组(owned) 与 "Joined" 分组(member)
- 第一次 invite 落地后,switcher 自动弹开 1 次(脉冲提示),提示 "You also have your own workspace"

---

## 3. 实现拆解

### 3.1 Schema 改动

```sql
-- packages/db/migrations/00xx_user_default_server.sql
ALTER TABLE user ADD COLUMN default_server_id TEXT REFERENCES servers(id) ON DELETE SET NULL;
CREATE INDEX ix_user_default_server ON user(default_server_id);
```

`runOnboarding` 写入新建 workspace 时同时 `UPDATE user SET default_server_id = <newServerId> WHERE id = <userId>`。

### 3.2 API 改动

| 文件 | 改动 |
|---|---|
| `apps/api/src/routes/me.ts` | `/me` 响应增 `defaultServerId`、`ownedServers[]`、`joinedServers[]`(分组);保留 `servers` 兼容 |
| `apps/api/src/routes/me.ts` | 新增 `PATCH /api/v1/me/default-server { serverId }` |
| `apps/api/src/routes/bridge.ts` | 不动 |
| `apps/api/src/routes/invites.ts` accept handler | 接受成功后**不 push 任何 server**,响应里返回 `{ serverSlug, ownedSlug }`(让前端决定) |
| `packages/auth-core/src/onboarding.ts` | 末尾 `UPDATE user.default_server_id`;区分 invite-flow vs solo-flow(参数化欢迎语) |

### 3.3 Web 改动

| 文件 | 改动 |
|---|---|
| `apps/web/src/lib/api.ts` | `me()` 接 `defaultServerId/ownedServers/joinedServers`;新增 `setDefaultServer(id)` |
| `apps/web/src/app/page.tsx` (marketing `/`) | 登录用户访问 `/` 时 `useEffect` 调 `me()`,跳 `defaultServerId || ownedServers[0]` |
| `apps/web/src/app/invite/[id]/page.tsx` | accept 成功后,push 到 **invited slug**(D1);URL 带 `?welcome=joined` 触发欢迎 toast |
| `apps/web/src/app/s/[slug]/page.tsx` | wizard 不再用当前 slug 的 serverId;改用 `ownedServers[0].id`;当前页是 invited(非 own)时不弹 wizard,改在顶部展示 banner |
| `apps/web/src/components/setup-wizard.tsx` | 接收 `targetServerId` 显式 prop,内部命名/copy 跟"my workspace"对齐 |
| `apps/web/src/components/sidebar.tsx` / `workspace-switcher.tsx` | 按 owner/member 分组;owner 区放最上;增 default 标记 |
| `apps/web/src/app/s/[slug]/settings/account/page.tsx` | 新增 "Default workspace" 下拉 |
| `apps/web/src/app/s/[slug]/welcome-toast.tsx` (新增) | 读 `?welcome=joined`,显示一次性 toast,清掉 query |

### 3.4 验收 case

| Case | 期望 |
|---|---|
| 全新用户单飞注册 | 落 `/s/{ownedSlug}`,wizard 弹,key 绑 owned,bridge 起来后 own agent online,wizard 关 |
| 全新用户经 invite 注册 | 落 `/s/{invitedSlug}` + welcome toast "You joined X; your own workspace is at the top-left";在 invited 页不弹 wizard,顶部 banner "Set up your bridge in `<Your Workspace>` to bring YOUR agents online"(link)|
| 已注册用户接 invite | 跟全新用户同样路径,但不创建新 personal workspace(已有);wizard 状态按 owned workspace 当前 bridge 状态决定 |
| 用户在 owned workspace 完成 wizard 后切到 invited | wizard 不再弹;agent online 状态正确显示(invited workspace 的 agent 如果是别人的,不归她管;她在 invited 里建的 agent,显示 "needs key for this workspace" 提示 + 一键引导 P2) |
| 用户改 default workspace | `/` 跳到新 default;sidebar 默认展开新 default 的分组 |
| Olivia 现状回归测试 | 上线后 Olivia 访问 `/`,跳她自己 workspace;wizard 弹;她跑完拿到绑自己 workspace 的 key,换 bridge 配置 → 自己 workspace 的 Onboarding Assistant online,她之前发的"中文"等消息得到回复 |

### 3.5 兼容性 / 回滚

- `default_server_id` 可空,旧用户不强制设置;读取处永远兜底 owned[0]。
- `/me` 旧字段保留。
- invite-accept 响应字段是 **加**(`ownedSlug`),旧客户端不读不会坏。
- 回滚:revert web + api 部署即可,DB schema 是 additive,留着不影响旧代码。

### 3.6 安全

- 不改 machine_keys 模型,不改 bridge.ts 的 mk.serverId 过滤 → 现有跨 workspace 隔离不变。
- `PATCH /me/default-server`:必须 `subject.kind==="user"`(machine key 不能改);写入前校验 `serverId` 在用户的 membership 里(避免 IDOR)。
- invite-accept 响应里 `ownedSlug` 是当前用户自己的,无泄露风险。

### 3.7 工程产物

1. 1 个 migration:`packages/db/migrations/00xx_user_default_server.sql`
2. `me.ts`、`onboarding.ts`、`invites.ts`、`api.ts`、`page.tsx`、`setup-wizard.tsx`、`workspace-switcher.tsx`、`sidebar.tsx`、`account/page.tsx`、`invite/[id]/page.tsx`、新建 `welcome-toast.tsx`
3. 邮件文案微调
4. 测试:`apps/api/test/invites.test.ts` 新增 invite-accept 响应字段 case;新增 `users.default_server_id` 持久化 case

---

## 4. 待 codex-cli 复核重点

- D1/D2 的二选一是否合理(Slack-like 落 invited + wizard pin own 是否会引入新的 UX 怪味)
- D4 默认 workspace 三级回退是否过设计
- D7 sidebar 自动弹开 switcher 是否打扰
- `runOnboarding` 在 invite-flow 里**不弹 wizard** 但仍创建 onboarding agent + 欢迎消息,是否多此一举?(可能简化:invite-flow 用户的 personal workspace 不创建 onboarding agent,只创建空 workspace)
- machine_keys 不动是否能撑到 Phase 2(多 workspace 用户增多后是否有更早爆雷的可能)
- 全表 ALTER 在 D1 上的迁移代价 / 锁影响
