# Pump.fun 代币抽奖 Demo（v0）

本仓库是 `PRD.md` 的工程化落地：**不写合约、资金链下托管、主网运行**的抽奖 Demo。

## 目录结构

- `apps/web`：业务服务（Next.js，包含前端 + API）
- `apps/signer`：签发服务（Signing Service，负责出金交易构建与签名；仅供业务服务内部调用）

## 当前进度

- 已完成：M0 / M1 / M2 / M3（核心接口）/ M4
- 待完成：M5–M8（开奖/出金/webhook/backfill/测试完善）

## 环境要求

- Node.js：>= 22
- npm：>= 10

## 环境变量（M0–M4）

### `apps/web/.env.local`（业务服务）

必需：

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `SOLANA_RPC_URL`
- `USDC_MINT`
- `PLATFORM_FEE_WALLET`
- `CUSTODY_WALLET_PUBLIC_KEY`
- `HELIUS_API_KEY`
- `HELIUS_WEBHOOK_ID`
- `CRON_SECRET`（用于管理接口）

建议：

- `ORDER_EXPIRES_SECONDS`（默认 600）
- `RELEASE_GRACE_SECONDS`（默认 120）
- `DRAFT_EXPIRES_SECONDS`（默认 600）
- `DEFAULT_COVER_IMAGE_URL`

回调相关（可选）：

- `HELIUS_WEBHOOK_SECRET`

### `apps/signer/.env.local`（签发服务）

仅在启动 signer 时必需：

- `SIGNER_SECRET`
- `PORT`

> 注：如数据库要求 SSL，运行迁移/测试时建议带 `PGSSLMODE=require` 或在 `DATABASE_URL` 中加 `sslmode=require`。

## Helius Webhook 配置（M3 必需）

1. 在 Helius 控制台创建 **Raw Transaction Webhook**。
2. Commitment 选择 `finalized`。
3. Webhook URL 必须是公网可访问的 HTTPS 地址（例如 Render 的服务域名）。
4. 获取 `HELIUS_WEBHOOK_ID` 并填入 `.env.local`。

> M3 会通过 Helius API 把 `usdc_vault/prize_vault` 追加到 webhook 的监听地址列表。

## 本地开发（M4 已实现）

1. 安装依赖：
   - `npm install`
2. 复制环境变量：
   - `cp apps/web/.env.example apps/web/.env.local`
   - `cp apps/signer/.env.example apps/signer/.env.local`
3. 迁移数据库：
   - `PGSSLMODE=require npm -w apps/web run db:migrate`
4. 启动服务：
   - 业务服务：`npm run dev`
   - 签发服务（可选）：`npm run dev:signer`

## 常用命令

- 格式化：`npm run format`
- Lint：`npm run lint`
- 测试：`PGSSLMODE=require npm run test`
