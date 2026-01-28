# v0 Demo 关键取舍与约束（仅供 AI 代理）

## 目标与范围
- 目标：pump.fun 生态内的代币奖池抽奖 Demo（最小可用）
- v0 不做：合约托管、公平性证明（VRF/commit-reveal）、自动退款/自动派奖
- Demo 网络：始终跑 Mainnet

## 工程实现约束（v0）
- backfill：每 10 分钟对近期活跃 vault 做增量补漏（范围控制 + 单次拉取限额；以 `signature` 强幂等，允许重复回放）
- Signing Service：采用方案 B（公网可访问 + `SIGNER_SECRET` 鉴权），不对前端暴露、仅保留必要路由、只接收 `payout_id` 并从 DB 二次校验；v0 暂不加额外限流
- 测试：v0 不引入第三方测试框架，优先使用 Node 内置 `node:test`

## 核心机制
- 资金托管：拆分独立签发服务（Signing Service）持有托管热钱包私钥（业务服务不持有私钥）；每个 raffle 创建独立的 `usdc_vault/prize_vault`（普通 token account，owner=托管钱包）
- 创建：Creator 作为 payer 支付 token account rent 与手续费；`prize_mint` 支持经典 Token Program / Token-2022（需落库 `prize_token_program_id`，创建 `prize_vault` 时按该 mint 计算 account space/rent）；前端生成临时 keypair 仅用于创建账户地址（创建后无需保存）；vault 创建与奖池转账必须在同一笔交易内完成，避免出现“空 vault”半成功状态；确认存入以 `prize_vault` 链上净入账作为最终 `prize_amount`
- DRAFT 过期：不建议直接删除 DRAFT（避免“链上已存入但未确认”导致资产孤儿）；可标记过期并从列表隐藏，但需保留补交/重新校验入口
- 入账确认：使用 Helius Raw Transaction Webhook（确认级别 `finalized`）监听 `usdc_vault/prize_vault` 入账并自动记账；投递语义按“至少一次”，后端以 `signature` 幂等去重。vault 地址需先落库并加入 webhook 监听列表（Dashboard 仅 25 地址；API 单 webhook 上限 100,000；每个 raffle 新增 2 个地址；创建流程需先注册 vault 再发起存入交易）；保留用户补交 `txSignature` 触发立即重试确认；直转入账落库为 `UNMATCHED`（不记票、不自动退款）
- 购票：订单预占 + 过期释放；售票截止 `sale_end_at = draw_at - 2 分钟`；开奖执行 `draw_execute_at = draw_at + 1 分钟`；`expires_at = min(created_at + 10 分钟, sale_end_at)`；预占在 `release_at = expires_at + 120s` 后释放；支付交易由后端生成（未签名，`Memo=order_id`），确认时以链上 `blockTime` 判定是否过期（若 raw 交易缺失 `blockTime`，用 `slot -> getBlockTime(slot)` 补齐，并在 `draw_execute_at` 前多次重试）
- 开奖：按票抽 `winning_tickets_count` 次不放回；结果落库为“每钱包中奖票数”，不存单张票编号
- 领取：签发服务构建并 partial sign（内部接口 `POST /internal/payouts/:id/sign-tx`，只接收 `payout_id` 并从 DB 读取参数二次校验）；用户作为 fee payer 补签并上链（用户自付 gas）
- 领取截止：`claim_deadline_at = resolved_at + 30 天`；过期后资产无法领取（不再签发出金交易；资产留在 vault，v0 暂不处置）
- 紧急止血：项目方可手动暂停/恢复“出金交易签发”（`signing:paused` 存于 Render KV，暂停期间签发服务拒绝签发）
- v0 暂缓：一键领取（claim-all）与打包多指令

## pump.fun 限定（v0）
- 启发式过滤：仅允许 mint 地址后四位为 `pump` 的代币作为奖池
- 不提供“手动输入 mint”兜底，避免绕过

## 平台收入与直转资产
- v0 仅实现：平台费 8% USDC 由业务服务定时归集到平台手续费钱包（内部调用签发服务签名；托管钱包付 gas）；分账只按 `sold_tickets` 台账计算，不从 `usdc_vault` 余额反推
- v0 暂不实现：余数（USDC/奖池 token）、直转到 vault 的额外资产等的提取与处置（先留在 vault）
