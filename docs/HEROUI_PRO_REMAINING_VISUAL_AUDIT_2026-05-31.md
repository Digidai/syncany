# HeroUI Pro Remaining Visual Elements Audit

日期：2026-05-31
范围：Raltic Web（全站页面、弹窗、workspace shell、desktop web routes）
当前结论：P0/P1 交互控件、状态控件、弹窗、列表、表单与移动端输入风险已收口；剩余项只保留为 P2/P3 观察项，不再作为阻塞迁移清单。

## 判定标准

- 必须使用 HeroUI Pro 包装层承载交互控件：`Button`、`Input`、`Textarea`、`Select`、`Dialog`、`Alert`、`Card`、`Chip`、`Tabs`、`Menu`。
- 业务页面不得直接导入 `@heroui/react/*`，必须通过 `apps/web/src/components/heroui-pro/*`。
- 业务页面不得直接写可见原生 `<button>`、`<input>`、`<select>`、`<textarea>`、`<dialog>`。允许项仅限 HeroUI wrapper 内部和 `Input unstyled type="file"` 这类不可见系统控件。
- `section`、`main`、`article`、`ul/li`、`dl/dt/dd`、`pre/code`、头像、图标点、SVG logo 属于语义/内容/装饰结构；只在它们承担 card、alert、badge、button、tabs、dialog 等视觉组件职责时才列为迁移项。
- `Card render={<section />}` 是 server-safe 的 tokenized shell，用于 full-bleed 语义 section；它不等同于 HeroUI `Card.Root`，不能拿它来证明“真实 CardRoot 覆盖率”。真正的卡片/面板仍应使用 `Card` + `CardPanel`。

## P0 已完成

1. Workspace shell/chat/mobile composer
   - `workspace-shell.tsx`、`sidebar.tsx`、`message-area.tsx`、`tiptap-message-input.tsx` 已走 HeroUI Pro shell/sidebar/navbar、HeroUI wrapper、移动 visual viewport 处理。

2. 全站弹窗关闭按钮与移动 overlay
   - `dialog.tsx`、`alert-dialog.tsx`、`confirm-dialog.tsx` 统一 overlay/close contrast、safe-area footer、mobile viewport。
   - `setup-wizard.tsx` 已从手写 overlay 迁到 HeroUI Dialog。

3. 移动端输入框 zoom/遮挡
   - 通过全局 input 16px 规则、workspace visual viewport、chat mobile E2E 覆盖。

## P1 已完成

1. Auth/public invite surfaces
   - `invite/[id]` loading/error/auth/accept states 使用 `Card` + `Button`。
   - `verify-email` 成功/错误状态使用 `Card` + `Alert`。

2. Workspace directory pages
   - `/s/[slug]` root、agents、agent detail、channels、people、tasks、inbox 主要列表/空态/状态 badge 已迁到 `Card`/`Chip`/`Tabs`。

3. Settings pages
   - settings nav 使用 `Button render={<Link />}`，mobile 横向 scroll。
   - account/workspace/members/agents/keys/connectors 主要行、状态、危险区、machine runtime、invite row 使用 `Card`/`Chip`/`Alert`。

4. Dialogs/popovers/components
   - create channel、channel members、channel settings、mention picker 的 selected/active contrast 已从实心 accent 改为 soft state。
   - sidebar mobile actions 默认可见；create channel 改为局部 reload，不再硬刷新页面。
   - `new-dm-dialog` 移除死 focus trap，明确依赖 HeroUI modal。

5. Marketing/public core surfaces
   - marketing nav dropdown、newsletter/waitlist states、desktop welcome/launch/runtimes/teams/indie/connectors/security/legal pages 的 CTA、状态 badge、表单反馈、核心卡片已使用 HeroUI wrapper。
   - `MarketingButton` 保留为 HeroUI `Button` 的主题化入口，不再使用旧 desktop hex 按钮系统。

## P2 观察项（非阻塞）

1. Marketing homepage仍有产品演示、头像、表格、代码预览等高度定制内容结构。
   - 当前这些元素已嵌入 HeroUI wrapper/tokenized shell，不再是旧控件系统；但它们仍不是 template-chat 级别的完全模板化 marketing redesign。
   - 后续如要进一步接近 template-chat，可单独做 marketing visual redesign，而不是继续机械替换。

2. Legal/prose 页面保留 `article/prose/code` 语义。
   - `Alert` 已用于提示块；行文结构不适合强行包成卡片。

3. Brand/avatar/logo/dot/icon micro-decoration 保留手写 CSS。
   - 它们不是可交互控件，也不是 card/dialog/form/list shell。

## Guardrails

- `e2e/heroui-source-guard.spec.ts` 覆盖：
  - 禁止业务文件直接原生控件。
  - 禁止 wrapper 外直接 `@heroui/react/*`。
  - 限制 `@heroui-pro/react/*` 只在 shell/sidebar/message-area/select 等明确白名单内使用。
- broad UI review 仍需搭配：
  - `pnpm --filter @raltic/web exec tsc --noEmit`
  - `pnpm --filter @raltic/web lint`
  - `git diff --check`
  - HeroUI page/dialog/mobile E2E matrix
