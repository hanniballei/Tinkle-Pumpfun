# /pumpfun-hackthon 代理协作约定（仅供 AI 代理使用）

## 代码质量与开发原则

- 只改动必要的部分，优先复用现有成熟代码，避免重复造轮子。
- 架构设计时让边界情况自然融入常规逻辑，而不是单独打补丁。
- 单个代码文件不超过 1000 行，否则应当进行功能拆分。
- 保持代码简单直观，不过度设计复杂架构方案。
- 代码应表达实际逻辑，结构清晰，不保留不再使用的代码，不留无用的混淆项，避免未来维护困惑。
- 代码注释使用中文（必要时保留英文专业名词，并在首次出现时附简要中文注释）。

## 测试与验证

- 所有变更必须通过对应语言的 lint/format/test 后再回传。
- 本仓库已引入 Node.js/TypeScript（npm workspaces）：
  - `apps/web`：Next.js（前端 + API）
  - `apps/signer`：Signing Service（Hono）
- 运行环境与版本约束：Node.js >= 22，npm >= 10（以根目录 `package.json` 的 `engines` 为准）。
- 安装依赖：`npm install`
- 格式化：`npm run format`（Prettier；默认忽略 `PRD.md` 与 `.agentdocs/`）
- Lint：`npm run lint`（web：ESLint；signer：`tsc --noEmit`）
- 测试：`npm run test`（v0 不引入第三方测试框架，优先使用 Node 内置 `node:test`）
- 本地开发：
  - 业务服务：`npm run dev`
  - 签发服务：`npm run dev:signer`

## 文档与记忆（.agentdocs）

- 文档与记忆使用 Markdown，存放在 `.agentdocs/` 及其子目录下，仅面向 AI 代理使用。
- 启动新任务时先读取 `.agentdocs/index.md`；如缺少跨模块约束/设计约定，应补齐文档并更新索引。

## 沟通原则

- 与用户的所有回复与沟通，文档与代码注释均使用中文。
