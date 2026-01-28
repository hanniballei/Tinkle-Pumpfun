# v0 Demo 实现 TODO（按 `PRD.md`）

> 目标：实现“可在 Solana Mainnet 长期跑的 Demo”，不写合约、资金链下托管、依赖 Helius Webhook 自动入账，并用 backfill 补漏提升可恢复性。

## 已确认的决策（来自讨论）

- backfill：每 10 分钟跑一次；按 vault 地址**增量**拉取；以 `signature` 强幂等；范围与限额控制成本（不做全量扫描）。
- Signing Service：选方案 B（公网可访问 + `SIGNER_SECRET` 鉴权），但不对前端暴露、仅保留必要路由、只接收 `payout_id` 并从 DB 二次校验；Demo 版本先不做额外限流。
- 测试：Demo 版本先不引入第三方测试框架；单测/集成测优先使用 Node 内置 `node:test`。

## 里程碑与步骤（建议按顺序交付，每步可演示）

### M0：工程初始化（脚手架）

- [x] 确定仓库结构：业务服务（Next.js）与签发服务（Hono）分开部署，符合 PRD 的“私钥隔离”。
- [x] 明确包管理与 Node 版本（并写入 `AGENTS.md`：安装、lint/format/test 命令与版本约束）。
- [x] 准备环境变量清单与最小运行手册（Render + Cloudflare + Helius 配置项）。

### M1：数据库与迁移

- [x] 按 PRD「数据模型（建议）」落地最小表：`raffles/orders/inbound_transfers/participants/winners/payouts`。
- [x] 迁移工具：优先用“纯 SQL migration + 一个脚本 runner”（避免引入重型框架）。
- [x] 关键约束与索引：`signature`/`idempotency_key` 唯一键、常用查询索引、必要的外键。

### M2：登录与鉴权（SIWS）

- [ ] 实现签名登录：challenge（nonce）→ verify（签名）→ 会话（cookie/JWT）。
- [ ] 写操作统一鉴权；webhook 与 `/api/admin/*` 走共享密钥鉴权（按 PRD：`HELIUS_WEBHOOK_SECRET` / `CRON_SECRET`）。

### M3：创建抽奖闭环（DRAFT → ACTIVE）

- [ ] `POST /api/raffles`：创建 DRAFT（校验 draw_at、ticket/中奖票等规则）。
- [ ] `POST /api/raffles/:id/vaults`：注册 `usdc_vault/prize_vault`，并调用 Helius API 追加监听地址列表。
- [ ] `confirm-prize-deposit`：支持 webhook 触发 + 用户补交 `txSignature`；以 `prize_vault` 净入账固化最终 `prize_amount`，状态转 ACTIVE。
- [ ] DRAFT 过期策略：不删除，只做过期标记/隐藏，并保留补交/重新校验入口（避免资产孤儿）。

### M4：购票闭环（预占 → 支付确认 → 记票/拒付）

- [ ] `POST /api/raffles/:id/orders`：创建订单并预占；固化 `expires_at/release_at`。
- [ ] `POST /api/orders/:id/pay-tx`：后端生成未签名支付交易（锁定 `USDC_MINT`/`usdc_vault`/金额/`Memo=order_id`）。
- [ ] `confirm-payment`：webhook 触发 + 用户补交 `txSignature`；按 `blockTime` 判定是否按时；不足票/已释放导致不记票则标 `REJECTED_PAID`。
- [ ] 释放预占：处理 `RESERVED` 且 `now>=release_at` 的订单，事务+行锁保证不超卖。

### M5：开奖闭环（Cron）

- [ ] `POST /api/admin/draw-due`：只处理到期 ACTIVE；开奖前收敛待确认入账；事务内原子写入 `winners` + 状态变更，避免“SUCCEEDED 但无 winners / 重复开奖漂移”。

### M6：出金闭环（payouts + Signing Service）

- [ ] 统一 `payouts` 台账 + `idempotency_key`（所有退款/领奖/结算/平台费归集都先落库再签发）。
- [ ] Signing Service（方案 B）最小实现：
  - [ ] 仅暴露必要路由（例如 `POST /internal/payouts/:id/sign-tx` + healthz）。
  - [ ] 强制校验 `X-SIGNER-SECRET`；只接受 `payout_id`/`action`；所有转账参数从 DB 读取并二次校验。
  - [ ] 支持 `signing:paused` 开关；暂停时业务服务与签发服务均拒绝签发。
  - [ ] `RESIGN` 受控：必须确保旧交易未成功（至少 `finalized` 未命中）且意图不变。
- [ ] 业务服务出金接口：`claim-prize-tx/refund-tx/return-prize-tx/settle-tx/reject-refund-tx/sweep-platform-fees`。
- [ ] `POST /api/tx/submit-result`：前端回传上链结果以更新 DB（按 `tx_signature` 幂等）。

### M7：Webhook + backfill（长期跑关键）

- [ ] `POST /api/webhooks/helius`：校验 `X-WEBHOOK-SECRET`，按 `signature` 幂等；解析净入账并匹配订单/奖池存入；无法匹配落库 `UNMATCHED`。
- [ ] 缺 `blockTime`：用 `slot -> getBlockTime(slot)` 补齐，并在 `draw_execute_at` 前重试收敛。
- [ ] `POST /api/admin/backfill-vaults`：每 10 分钟跑一次的增量补漏任务：
  - [ ] 仅覆盖近期活跃 vault（范围控制）
  - [ ] 维护每 vault 游标（`last_seen_signature/slot`）
  - [ ] 单次拉取限额与并发控制（控制成本）
  - [ ] 与 webhook 同一套解析/匹配逻辑（幂等安全重放）

### M8：测试与验证（不引入测试框架）

- [ ] 单元测试（`node:test`）：净入账解析、订单过期判定、幂等去重、状态机关键约束等。
- [ ] 集成测试（`node:test`）：本地 Postgres + 模拟 webhook 回调 + 关键 API 路径 smoke。
- [ ] 在 `AGENTS.md` 补齐可执行的 `lint/format/test` 命令（后续开始写代码前必须先定）。
