# HeroUI Pro Remaining Visual Elements Audit

日期：2026-05-31  
范围：Raltic Web（全站视觉元素审计）  
依据：当前代码扫描（`apps/web/src/app` + `apps/web/src/components`）

## 判定标准
- “剩余非 HeroUI 视觉元素” = 目前页面/组件本体未使用 HeroUI Pro 包装组件（`@/components/heroui-pro/*` 或 `@heroui-pro/react/*`）来承载主要视觉区块（容器/表单/卡片/列表区域）
- 仅靠 Tailwind 类名或 `<div>` 的布局仍需视为待清理

## P0（先做）
1. `apps/web/src/app/desktop/welcome/page.tsx`（状态：已替换主卡片容器，待复核移动端间距与文案对齐）
   - 全页仍为自定义 `main/section/div` + 自定义卡片样式
   - 建议：改为 `Card / CardHeader / CardPanel` 作为步骤卡片容器；按钮保持 HeroUI `Button`（`MarketingButton` 已经是封装）

2. `apps/web/src/app/desktop/launch/page.tsx`（状态：已完成）
   - 状态块、步骤块、警告行大量使用手写 `div` 边框与 spacing
   - 建议：主面板与两个侧栏面板改为 HeroUI `Card`；状态行改为 `Card` 片段

3. `apps/web/src/app/(marketing)/page.tsx`
   - 首页是最高流量页，几乎全量自定义标签：多个大 `section/div` 卡片和列表没有 HeroUI 包装
   - 建议：引入 marketing 视觉原语映射，优先替换：
     - Hero/Feature 卡片
     - 对比卡片、路线图块、FAQ 容器
     - 底部 footer 区域（与共享 footer 统一）
   - 状态：待开始（影响最大，放在下一轮）

## 剩余待补齐（当前扫描）
- `apps/web/src/app/(marketing)/page.tsx`
- `apps/web/src/app/(marketing)/desktop/page.tsx`
- `apps/web/src/app/(marketing)/runtimes/page.tsx`
- `apps/web/src/app/(marketing)/teams/page.tsx`
- `apps/web/src/app/(marketing)/indie/page.tsx`
- `apps/web/src/app/(marketing)/connectors/page.tsx`
- `apps/web/src/app/(marketing)/security/page.tsx`
- `apps/web/src/app/(marketing)/privacy/page.tsx`
- `apps/web/src/app/(marketing)/terms/page.tsx`
- `apps/web/src/app/desktop/layout.tsx`
- `apps/web/src/app/(marketing)/layout.tsx`
- `apps/web/src/components/marketing/shell.tsx`

## P1（本周内补齐）
4. `apps/web/src/components/marketing/footer.tsx`
   - 全页为纯自定义布局（`footer/div/ul/li`）
   - 建议：底栏用 HeroUI `Card` + `CardPanel`/`Separator` 重构，同时保持现有链接内容
   - 状态：已完成（已重构为 `Card` + `CardPanel` 容器，保留原有内容与链接）

5. `apps/web/src/components/marketing/section-header.tsx`
   - 仅文本容器
   - 建议：改为 `Card`/`CardPanel` 包裹，保留 `h2` 排版语义
   - 状态：已完成

6. `apps/web/src/components/marketing/runtime-page.tsx`
   - 作为所有 runtime 详情页的骨架页，内部多个 `section/div` 仍以原生布局为主
   - 建议：按功能区块（Hero、安装说明、Best at、FAQ、CTA）逐块 Hero 化
   - 状态：已完成基础容器级重构（Hero 区块结构待微调）

7. `apps/web/src/app/(marketing)/desktop/page.tsx`
8. `apps/web/src/app/(marketing)/runtimes/page.tsx`
9. `apps/web/src/app/(marketing)/teams/page.tsx`
10. `apps/web/src/app/(marketing)/indie/page.tsx`
11. `apps/web/src/app/(marketing)/connectors/page.tsx`
12. `apps/web/src/app/(marketing)/security/page.tsx`
13. `apps/web/src/app/(marketing)/privacy/page.tsx`
14. `apps/web/src/app/(marketing)/terms/page.tsx`
   - 以上页面在当前实现上使用大量原生容器卡片/列表/note block
   - 建议：统一为 `Card` + `Alert` 的视觉原语，保留文案与语义

## P2（同步清理）
15. `apps/web/src/app/desktop/layout.tsx`
16. `apps/web/src/app/(marketing)/layout.tsx`
17. `apps/web/src/components/marketing/shell.tsx`
   - 这三处是布局/壳层级，建议保持与全局主题一致的 HeroUI 匹配逻辑。

## P3（后续）
18. 全站 legal 文本页面中的大量段落列表（`prose` 风格）与按钮/链接区域
   - 当前功能可达性无碍，但视觉统一性仍需后续优化（可按页面分批）

## 备注
- `/app/s/[slug]/...` 与 auth 页面中已出现 HeroUI 输入/按钮/Card 等主要组件，暂不纳入本次首轮 P0/P1；
- 但仍建议后续对每个页面的 `border/rounded/panel` 自定义壳做第二层清理，避免“半接入”状态。
