# apps/web（业务服务）

本目录是业务服务（Next.js App Router），包含前端与对外 API。

## 本地启动

```bash
npm run dev
```

## 必备环境变量（M4）

必须：

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `SOLANA_RPC_URL`
- `USDC_MINT`
- `PLATFORM_FEE_WALLET`
- `CUSTODY_WALLET_PUBLIC_KEY`
- `HELIUS_API_KEY`
- `HELIUS_WEBHOOK_ID`
- `CRON_SECRET`（管理接口鉴权）

建议：

- `ORDER_EXPIRES_SECONDS`（默认 600）
- `RELEASE_GRACE_SECONDS`（默认 120）
- `DRAFT_EXPIRES_SECONDS`（默认 600）
- `DEFAULT_COVER_IMAGE_URL`

回调相关（可选）：

- `HELIUS_WEBHOOK_SECRET`

## 主要 API（M2–M4）

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

购票（M4）：

- `POST /api/raffles/:id/orders`
- `POST /api/orders/:id/pay-tx`
- `POST /api/orders/:id/confirm-payment`

订单释放（M4 管理接口）：

- `POST /api/admin/release-reserved`（`X-CRON-SECRET`）

> Webhook 回调地址需为公网 HTTPS，Helius 控制台创建 Raw Transaction Webhook 并获取 `HELIUS_WEBHOOK_ID`。

## API 使用示例（M4）

> 说明：以下示例需先登录并携带 `pf_session` Cookie。

### 1) 创建订单（预占）

```bash
curl -sS -X POST http://localhost:3000/api/raffles/<raffle_id>/orders \\
  -H 'Content-Type: application/json' \\
  -H 'Cookie: pf_session=<session_token>' \\
  -d '{ "qty": 1 }'
```

### 2) 获取支付交易（未签名）

```bash
curl -sS -X POST http://localhost:3000/api/orders/<order_id>/pay-tx \\
  -H 'Content-Type: application/json' \\
  -H 'Cookie: pf_session=<session_token>'
```

### 3) 确认支付（补交 txSignature）

```bash
curl -sS -X POST http://localhost:3000/api/orders/<order_id>/confirm-payment \\
  -H 'Content-Type: application/json' \\
  -H 'Cookie: pf_session=<session_token>' \\
  -d '{ "tx_signature": "<txSignature>" }'
```

### 4) 释放预占（管理员）

```bash
curl -sS -X POST http://localhost:3000/api/admin/release-reserved \\
  -H 'Content-Type: application/json' \\
  -H 'X-CRON-SECRET: <CRON_SECRET>' \\
  -d '{ "limit": 100 }'
```

## 辅助脚本

- `apps/web/scripts/send-tx.mjs`：用 base58 私钥签名并发送 `tx_base64`，输出 `txSignature`。

## 常用命令

- 测试（需要 SSL 的数据库）：`PGSSLMODE=require npm run test`
