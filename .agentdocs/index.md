## 产品文档
- `prd/v0-keys.md` - v0 Demo 的关键取舍与约束（实现前必读）

## 当前任务文档
- `../TODO.md` - v0 Demo 实现 TODO（当前执行清单）
- `workflow/260122-update-prd.md` - 更新 PRD：链下托管抽奖 v0 方案对齐（历史对齐记录）
- `workflow/260201-m4-ticket-orders.md` - M4 购票闭环实现（订单/支付确认/释放预占）

## 全局重要记忆
- v0 只做链下托管（无合约），只做启发式 pump.fun 过滤（mint 后四位为 `pump`）。
- v0 不记录单张票编号，只记录“每钱包购票数量/中奖票数”，奖池按票平分。
- Demo 始终跑 Mainnet。
- v0 暂缓一键领取（claim-all），先逐笔领取。
- DRAFT 不直接删除：避免“链上已存入但未确认”导致资产孤儿；可标记过期并从列表隐藏，但保留补交/重新校验入口。
- 入账确认：使用 Helius Raw Transaction Webhook（确认级别 `finalized`）监听 `usdc_vault/prize_vault` 入账并自动记账；投递语义按“至少一次”，以 `signature` 幂等去重。vault 地址需先落库并加入 webhook 监听列表（Dashboard 仅 25 地址；API 单 webhook 上限 100,000；每个 raffle 新增 2 个地址）；保留用户补交 `txSignature` 兜底；直转入账落库为 `UNMATCHED`（不记票、不自动退款）。
- backfill：每 10 分钟对近期活跃 vault 做增量补漏（范围控制 + 单次拉取限额；以 `signature` 强幂等，允许重复回放）。
- 托管私钥隔离：拆分独立签发服务（Signing Service）持有 `CUSTODY_PRIVATE_KEY`，业务服务不持有私钥；业务服务通过 `SIGNER_SECRET` 调用签发服务内部接口 `POST /internal/payouts/:id/sign-tx`（只传 `payout_id`/`action`，参数从 DB 读取并二次校验）生成/签名出金交易；`signing:paused` 以 Render KV 为单一开关，暂停期间业务服务出金接口与签发服务均拒绝签发。
- 签发服务部署（v0）：采用方案 B（公网可访问 + `SIGNER_SECRET` 鉴权），不对前端暴露、仅保留必要路由、只接收 `payout_id` 并从 DB 二次校验；v0 暂不加额外限流。
- 测试策略（v0）：不引入第三方测试框架，优先使用 Node 内置 `node:test`。
- 平台费：8% USDC 由业务服务定时归集到平台手续费钱包（内部调用签发服务签名；托管钱包付 gas）；分账只按 `sold_tickets` 台账计算，不从 `usdc_vault` 余额反推；余数与直转到 vault 的额外资产暂不处置。
- 购票：`sale_end_at = draw_at - 2min`，`draw_execute_at = draw_at + 1min`；`expires_at = min(created_at + 10min, sale_end_at)`，`release_at = expires_at + 120s`（释放预占）；支付交易由后端生成（未签名，`Memo=order_id`），确认以链上 `blockTime` 判定是否过期；若 raw 交易缺失 `blockTime`，用 `slot -> getBlockTime(slot)` 补齐并在 `draw_execute_at` 前重试；校验通过但不计票的订单记为 `REJECTED_PAID`，允许用户自助退款（用户自付 gas）。
- 奖池存入：`prize_mint` 支持经典 Token Program / Token-2022；需落库 `prize_token_program_id`；确认存入以 `prize_vault` 链上净入账（post-pre）作为最终 `prize_amount`。
- 领取截止：`claim_deadline_at = resolved_at + 30 天`；过期后不再签发出金交易（资产无法领取；资产留在 vault，v0 暂不处置）。
- 紧急止血：项目方可手动暂停/恢复“出金交易签发”（`signing:paused`）。
