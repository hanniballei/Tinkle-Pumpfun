# Pump.fun 代币抽奖 Demo（v0）

本仓库是 `PRD.md` 的工程化落地：**不写合约、资金链下托管、主网运行**的抽奖 Demo。

## 目录结构

- `apps/web`：业务服务（Next.js，包含前端 + API）
- `apps/signer`：签发服务（Signing Service，负责出金交易构建与签名；仅供业务服务内部调用）

## 环境要求

- Node.js：>= 22
- npm：>= 10

## 本地开发（骨架阶段）

1. 安装依赖：
   - `npm install`
2. 复制环境变量：
   - `cp apps/web/.env.example apps/web/.env.local`
   - `cp apps/signer/.env.example apps/signer/.env.local`
3. 启动：
   - 业务服务：`npm run dev`
   - 签发服务：`npm run dev:signer`

> 说明：当前仅为 M0 工程骨架，后续里程碑会逐步补齐数据库、Webhook、backfill 与出金逻辑。
