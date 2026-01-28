# 260122 - 更新 PRD：链下托管抽奖 v0 方案对齐

## 背景
- Hackathon Demo：不考虑开奖公平性证明，不写合约，资金由托管热钱包控制。
- Demo 始终跑 Solana Mainnet。

## 已对齐的关键决策
- pump.fun 限定：v0 采用启发式过滤，仅允许 mint 地址后四位为 `pump` 的代币作为奖池。
- 抽奖逻辑：按票抽 `winning_tickets_count` 次不放回；奖池按票平分；不记录单张票编号，只记录“每钱包购票数量/中奖票数”。
- 自动入账（生产必选）：使用 Helius Raw Transaction Webhook（确认级别 `finalized`）监听 `usdc_vault/prize_vault` 入账并自动记票/确认奖池存入；投递语义按“至少一次”，后端以 `signature` 幂等去重。vault 地址需先落库并加入 webhook 监听列表（Dashboard 仅 25 地址；API 单 webhook 上限 100,000；每个 raffle 新增 2 个地址；创建流程需先注册 vault 再发起存入交易）；保留用户补交 `txSignature` 触发立即重试确认；直转入账落库为 `UNMATCHED`（不记票、不自动退款）。
- 并发/超卖：后端订单预占（`expires_at = min(created_at + 10min, sale_end_at)`，`sale_end_at = draw_at - 2min`，预占在 `release_at = expires_at + 120s` 后释放），确认支付时再记票；后台开奖在 `draw_execute_at = draw_at + 1min` 执行；确认时以链上 `blockTime` 判定是否过期（若 raw 交易缺失 `blockTime`，用 `slot -> getBlockTime(slot)` 补齐，并在 `draw_execute_at` 前多次重试收敛入账）；若链上校验通过但过期/余票不足导致不记票，则订单标记为 `REJECTED_PAID` 并允许用户自助退款（用户自付 gas）。
- 购票交易生成（方案A）：购票支付交易由后端生成（未签名，`Memo=order_id`），前端让用户钱包签名发送，降低“转错 mint/地址/金额”导致的校验失败。
- 托管钱包（PhaseA）：每个 raffle 创建 2 个独立 token account（`usdc_vault/prize_vault`），owner=托管钱包；Creator 作为 payer 支付 rent/手续费；临时 keypair 仅用于创建账户地址；vault 创建与奖池转账必须在同一笔交易内完成（原子性）。
- Token Program 兼容（v0）：`prize_mint` 支持经典 Token Program / Token-2022；需落库 `prize_token_program_id`；确认奖池存入以 `prize_vault` 链上净入账作为最终 `prize_amount`。
- 出金幂等/重签：同一笔 payout 使用 `idempotency_key`；交易过期允许重签，但必须保证 DB 行锁 + 链上确认旧交易未成功，避免重复转出。
- 托管私钥隔离（最小可行）：拆分独立签发服务（Signing Service）持有 `CUSTODY_PRIVATE_KEY`，业务服务不持有私钥；业务服务通过 `SIGNER_SECRET` 调用签发服务内部接口 `POST /internal/payouts/:id/sign-tx` 生成/签名出金交易（签发服务只接受 `payout_id`/`action`，参数从 DB 读取并二次校验；`signing:paused` 以 Render KV 为单一开关）。
- 领取截止：`claim_deadline_at = resolved_at + 30 天`；过期后资产无法领取（不再签发出金交易；资产留在 vault，v0 暂不处置）。
- 紧急止血：项目方可手动暂停/恢复“出金交易签发”（`signing:paused`，暂停期间签发服务拒绝签发）。
- 平台收入口径（v0 Demo）：平台费 8% USDC 由业务服务定时归集到平台手续费钱包（内部调用签发服务签名；托管钱包付 gas）；余数与直转到 vault 的额外资产暂不提取处置。
- 分账口径：Creator 92% 与平台费 8% 均只按 `sold_tickets * ticket_price_usdc` 台账计算，不从 `usdc_vault` 余额反推（避免混入 `REJECTED_PAID` 待退款与直转资金）。
- 领取策略（v0 Demo）：暂缓一键领取（claim-all），先逐笔领取以降低交易体积与失败概率。
- 前端部署：Render 为源站 + Cloudflare 作为解析/CDN 代理。
- RPC：Mainnet 建议使用稳定 RPC（例如 Zan）降低超时/限流导致的校验失败。

## TODO（后续实现阶段再展开）
- [ ] 依据 PRD 实现前后端与数据库
- [ ] 上线前补齐关键校验与幂等策略
