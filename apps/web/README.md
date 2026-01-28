# apps/web（业务服务）

本目录是业务服务（Next.js App Router），包含前端与对外 API。

## 本地启动

```bash
npm run dev
```

## 必备环境变量（M3）

必须：
- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `SOLANA_RPC_URL`
- `USDC_MINT`
- `PLATFORM_FEE_WALLET`
- `CUSTODY_WALLET_PUBLIC_KEY`
- `HELIUS_API_KEY`
- `HELIUS_WEBHOOK_ID`

建议：
- `DRAFT_EXPIRES_SECONDS`（默认 600）
- `DEFAULT_COVER_IMAGE_URL`

## 主要 API（M2/M3）

认证：
- `POST /api/auth/challenge`
- `POST /api/auth/verify`
- `GET /api/auth/me`
- `POST /api/auth/logout`

创建抽奖（M3）：
- `POST /api/raffles`
- `POST /api/raffles/:id/vaults`
- `POST /api/raffles/:id/prize-deposit-tx`
- `POST /api/raffles/:id/confirm-prize-deposit`

> Webhook 回调地址需为公网 HTTPS，Helius 控制台创建 Raw Transaction Webhook 并获取 `HELIUS_WEBHOOK_ID`。
