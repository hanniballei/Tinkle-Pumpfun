# Pump.fun 代币抽奖 Demo（完全链下托管版）PRD

> 版本：v0（Hackathon Demo）
>
> 核心取舍：不写合约、资金链下托管、不开公平性证明、使用 Helius Raw Webhook 监听 vault 入账并自动记账（保留用户补交 `txSignature` 的兜底入口）、普通用户在“领奖/退款/Creator 结算”时自付 Solana 手续费（gas）；平台费由业务服务定时归集（内部调用签发服务签名；托管钱包支付手续费）。

## 1. 项目目的

在 pump.fun 生态内提供一个**代币奖池抽奖**的最小可用 Demo：

- 发起者使用 pump.fun 代币作为奖池创建抽奖；
- 参与者使用 **USDC** 购买抽奖券获得抽奖机会；
- 到开奖时间：
  - 若售票数未达到最低开奖票数：抽奖失败，参与者可退款，发起者可取回奖池；
  - 若达到最低开奖票数：抽奖成功，链下生成中奖结果（按票），中奖用户可按票领取奖池代币，门票收入按 **92%/8%** 分给发起者/平台手续费钱包。

## 2. 产品范围

### 2.1 v0（Demo）要做

- Solana 钱包登录
- 主页列表：展示抽奖活动（类似 pump.fun 的卡片流/列表）
- 创建抽奖（表单 + 奖池存入校验）
- 购票（USDC 转账 + 订单校验）
- 自动入账：Helius Raw Webhook 监听 `usdc_vault/prize_vault`，减少“已支付但未记票/未确认”的争议
- 定时开奖（到点判定成功/失败 + 生成中奖结果）
- 领取：
  - 失败：用户领取退款（USDC），发起者取回奖池代币
  - 成功：中奖用户领取奖池代币；发起者领取票款收入（92%）；平台收取平台费（8%，由业务服务定时归集，内部调用签发服务签名）
  - 异常：若订单链上支付校验通过但不计票，用户可自助退款（`REJECTED_PAID`）
- Load Assets（Moralis）“按需加载 + 5 分钟冷却”

### 2.2 v0 不做（明确不在范围内）

- 不向用户证明开奖公平性/不可操纵性（不做 VRF / commit-reveal / 可复现随机证明）。
- 不做链上合约托管与强约束执行（完全信任托管钱包）。
- 不自建链上 indexer/全量扫描服务：仅依赖 Helius Webhook + 必要的 RPC 校验/补漏（见第 6.2 节）。
- 不做自动退款/自动派奖（退款/领奖/Creator 结算均由用户主动发起并自付 gas；平台费归集除外）。
- 不做反女巫、KYC、邀请返佣等增长模块。

## 3. 关键业务规则

- 票款币种：USDC（SPL Token）
- 分账比例：发起者 92%，平台 8%（平台手续费钱包为后端预设）
- 中奖票数：`winning_tickets_count`（按票抽奖；同一钱包可因持有多张中奖票而获得多份奖池份额）
- 抽奖券不编号（v0）：不存储每张票的编号；仅记录每个钱包的购票数量与中奖票数
- 余数处理（v0 Demo 暂不处置，留在 vault）：
  - 奖池代币：每张中奖票领取 `floor(prize_amount / winning_tickets_count)`，余数 `prize_amount - each * winning_tickets_count` 留在 `prize_vault`
  - 票款 USDC：票款收入 `ticket_revenue = sold_tickets * ticket_price_usdc`。按最小单位计算：
    - `creator_share = floor(ticket_revenue * 92 / 100)`
    - `platform_fee = floor(ticket_revenue * 8 / 100)`
    - 余数 `ticket_revenue - creator_share - platform_fee` 留在 `usdc_vault`
  - 分账计算口径：仅基于 `sold_tickets` 台账计算 `ticket_revenue/creator_share/platform_fee`，不以 `usdc_vault` 实际余额推算（余额可能包含 `REJECTED_PAID` 待退款资金、直转资金与余数等）
- 时间约束：`draw_at >= created_at + 1 小时`
- 售票截止（v0 固定）：`sale_end_at = draw_at - 2 分钟`；`sale_end_at` 后禁止创建购票订单；确认支付以支付交易链上 `blockTime <= sale_end_at` 判定
- 开奖执行时间（v0 固定）：`draw_execute_at = draw_at + 1 分钟`（对外仍展示 `draw_at`；后台任务在 `draw_execute_at` 执行，给订单回传与 RPC 确认留缓冲）
- 最低开奖票数：若到 `draw_execute_at` 仍 `sold_tickets < min_tickets_to_draw` 则失败
- 抽奖券总量硬上限（v0 Demo）：`total_tickets <= 10_000`
- 购票订单预占有效期（v0）：
  - `expires_at = min(created_at + 10 分钟, sale_end_at)`（可配置）
  - 支付是否“按时”：以支付交易链上 `blockTime` 判定 `blockTime <= expires_at && blockTime <= sale_end_at`（避免 RPC/网络延迟误伤）
  - 预占释放（避免超卖）：订单在 `release_at = expires_at + release_grace` 后才释放预占票数；v0 默认 `release_grace = 120s`（可配置，用于吸收交易确认与回传延迟）
  - 若订单已释放且余票已被售完：后续即便回传了“按时支付”的 `txSignature`，v0 仍可能判定为不记票；但若该支付链上校验通过，则订单应标记为 `REJECTED_PAID` 并允许用户自助退款（用户自付 gas）
- 建议约束：`min_tickets_to_draw >= winning_tickets_count`（避免“票数 < 中奖票数”造成体验怪异；v0 可直接校验并拒绝）
- 领取/退款/结算截止（v0 固定）：`claim_deadline_at = resolved_at + 30 天`；截止后不再签发用户/Creator 出金交易（过期资产无法领取；过期资产留在 vault，v0 暂不处置）
- 入账识别范围（v0）：通过 Helius Raw Webhook 监听 raffle 的 `usdc_vault/prize_vault` 入账并落库；对购票支付仍以 `Memo=order_id` 绑定订单并做链上校验。前端仍可补交 `txSignature` 触发立即重试校验（幂等）。
- 支付过期判定（v0）：仍以链上 `blockTime` 判定 `blockTime <= expires_at && blockTime <= sale_end_at`。若 raw 交易缺失 `blockTime`，后端用 `slot -> getBlockTime(slot)` 补齐；在 `draw_execute_at` 前允许多次重试确认，避免因 RPC/索引延迟误伤
- 直转（v0）：用户绕开前端直接转账到 raffle 的 vault（`usdc_vault/prize_vault`）：不记票、不自动退款；后端会落库为 `UNMATCHED` 入账以便对账，v0 暂不提供自助认领/处置。

## 4. 角色与用户流程

### 4.1 角色

- Creator（发起者）：创建抽奖、存入奖池、结算收入、失败取回奖池
- Buyer（参与者）：购票、失败退款、成功领奖
- Platform（平台）：收 8% 票款（USDC，由业务服务定时归集到平台手续费钱包，内部调用签发服务签名）；余数与直转资产 v0 暂不处置
- Backend（平台后端）：由“业务服务（App API）”+“签发服务（Signing Service）”组成
  - 业务服务：对外提供 API、验证链上交易、维护状态机；**不持有托管私钥**
  - 签发服务：仅负责出金交易的构建与 partial sign（部分签名交易）；**托管私钥仅存放在签发服务**

### 4.2 创建抽奖（Creator）

1. 连接 Solana 钱包并完成签名登录
2. 进入 Create Raffle 页面（默认不拉资产）
3. 点击 **Load Assets**（有 5 分钟冷却；若 5 分钟内已加载过则直接使用缓存结果展示下拉框）
4. 在下拉框中选择“钱包内的 pump.fun 代币及数量”（选择后不再要求填写 `prize_mint`）
5. 填写其余抽奖参数并提交创建（创建 raffle 记录为 `DRAFT`；前端校验：选中代币余额 ≥ `prize_amount`，按最小单位计算）
6. 前端生成 2 个 vault 的临时 keypair（仅用于新账户地址），并先把 `usdc_vault/prize_vault` 地址注册到后端（仅允许 `creator_wallet`；raffle=`DRAFT`）
   - 后端写入 `raffles.usdc_vault/prize_vault`，并将这两个地址加入 Helius Raw Webhook 监听列表（v0 先按每次追加实现；后续地址更新频率变高再改为批量合并更新）
7. 前端在同一笔交易中完成：
   - 创建并初始化 2 个独立的 SPL Token Account（vault）：`usdc_vault` 与 `prize_vault`
     - 二者 owner（token authority）均为托管钱包地址
     - `usdc_vault` 的 mint 固定为 `USDC_MINT`；`prize_vault` 的 mint 固定为 `prize_mint`
     - token program：
       - `usdc_vault` 使用 `USDC_MINT` 对应的 token program（由 mint account 的 `owner` 推导）
       - `prize_vault` 使用 `prize_mint` 对应的 token program（可能为经典 Token Program 或 Token-2022）
     - Creator 作为 payer 支付 rent 与手续费（vault 为普通 token account，不是 ATA，需要临时 keypair 创建）
     - 临时 keypair 仅用于创建 token account（`SystemProgram.createAccount` 需要新账户 signer）；创建完成后无需保存，资金控制权由 token account 的 owner=托管钱包决定
     - 创建 vault 时必须按 `mint + token_program_id` 计算 token account `space` 与 `rent`（Token-2022 的 token account 可能需要更大的空间）
   - “奖池代币 → `prize_vault`”转账
   - 必须保证“创建 vault + 初始化 token account + 奖池转账”在**同一笔交易**内完成：任一指令失败则整笔交易回滚，不会出现“vault 已创建但奖池未入账”的半成功状态（仅消耗手续费）
8. 前端可把 `txSignature` 提交后端触发立即校验（支持重复调用，用于补交/重试）；即使用户未提交，后端也会通过 Helius Raw Webhook（以及每 10 分钟 backfill 补漏）监听 `prize_vault` 入账并自动完成确认。链上校验通过后，抽奖变为 `ACTIVE`（确认时以 `prize_vault` 净入账固化最终 `prize_amount`）

### 4.3 购票（Buyer）

1. 选择购买数量 `qty`，后端创建订单并预占票数（仅允许在 `sale_end_at` 前创建；返回应付金额 + `expires_at/release_at`）
2. 前端向后端请求该订单的购票支付交易（base64，未签名），并让用户钱包签名发送（交易内容必须锁定：`USDC_MINT` + 收款 `usdc_vault` + 精确金额 + `Memo=order_id`；`recentBlockhash` 过期则重新请求）
3. 用户签名发送后，后端会通过 Helius Raw Webhook 监听 `usdc_vault` 入账并自动确认与记票；前端也可提交 `txSignature` 主动触发立即校验（可重复提交，用于补交/重试）。仅当 raffle 仍为 `ACTIVE` 时允许确认与记票。后端链上校验成功后：
   - 若支付链上 `blockTime <= expires_at && blockTime <= sale_end_at` 且余票足够：记票（订单 `PAID`；更新 `sold_tickets` 并释放预占）
   - 否则：不记票，订单标记为 `REJECTED_PAID`，允许用户自助退款（用户自付 gas）
   - 约束：同一订单只认 1 个 `pay_sig`；同一用户/订单的额外转账按直转处理（不记票、不自动退款）
     > 后端需定时（或在写请求中顺带）处理 `RESERVED` 且 `now >= release_at` 的订单：置为 `EXPIRED` 并释放预占；释放时需对 raffle 做行锁，避免与 `confirm-payment`/webhook 入账确认并发造成票数台账错误。

### 4.4 开奖（后台任务）

到 `draw_execute_at` 后（`draw_execute_at = draw_at + 1 分钟`）：

- 执行开奖前应先收敛该 raffle 的待确认入账（例如 `blockTime` 暂缺/确认度不足的订单支付），在 `draw_execute_at` 前多次重试确认，尽量减少“已支付但未计入 sold_tickets”的漏记
- 若 `sold_tickets < min_tickets_to_draw`：标记 `FAILED`
- 否则：标记 `SUCCEEDED` 并生成中奖结果（按票抽取 `winning_tickets_count` 次不放回；基于参与者的购票数量分布统计“每个钱包中奖票数”并落库；v0 可用简单伪随机）
- 状态进入 `SUCCEEDED/FAILED` 时写入 `resolved_at` 并计算 `claim_deadline_at = resolved_at + 30 天`
- v0 开奖算法（简单实现，不存票编号）：把参与者按 `tickets_bought` 展开为长度 `sold_tickets` 的数组，shuffle 后取前 `winning_tickets_count` 个；统计每个钱包出现次数作为其中奖票数
- 幂等要求：`draw-due` 必须只处理 `ACTIVE` 且到期的 raffle；写入 `winners` 与状态变更必须在同一 DB 事务内完成，避免出现 `SUCCEEDED` 但无中奖结果（或重复生成导致中奖结果漂移）

### 4.5 用户领取/退款/结算（用户自付 gas）

无合约情况下，托管钱包必须参与签名才能出金。为实现“用户付 gas”，采用**部分签名交易**：

- 业务服务调用签发服务构建交易（SPL Token Transfer 指令）
- 设置 `feePayer = 用户钱包`
- 签发服务用托管私钥先签名（partial sign）
- 业务服务返回交易（base64）给前端
- 前端让用户补签并发送上链

支持的领取/退款/结算类型：

- 失败：Buyer 退款（USDC）
- 失败：Creator 取回奖池（奖池 token）
- 成功：中奖用户领奖（奖池 token，按“未领取的中奖票数 × 每张中奖票份额”计算；同一钱包可多次中奖并合并领取）
- 成功：Creator 领取票款收入（USDC，按票款收入计算的 92%）
- 异常：订单 `REJECTED_PAID` 自助退款（USDC，退回 `expected_amount_usdc`）
  > 截止约束：以上所有出金动作仅允许在 `claim_deadline_at` 前发起并签发交易；过期后资产无法领取。

### 4.6 平台费归集（托管钱包付 gas）

平台不手动付 gas：由后端定时任务归集平台费到平台手续费钱包。

- 后端扫描可归集的 raffle（`SUCCEEDED` 且平台费未归集）
- 对每个 raffle 计算 `platform_fee = floor(ticket_revenue * 8 / 100)` 并逐笔上链转账（金额只按 `sold_tickets` 台账计算，不从 `usdc_vault` 余额反推）
- 托管钱包作为 signer + fee payer（需长期准备少量 SOL）
- 必须强幂等（同一 raffle 平台费最多成功一次）

## 5. 抽奖参数（创建字段）

必填字段（v0）：

- `prize_mint`：不在表单中手填，由“Load Assets 下拉框选择”得到（仍会落库）
- `prize_amount`：奖池代币数量（按最小单位存储，**不假设 decimals 一致**；最终以 `confirm-prize-deposit` 时 `prize_vault` 净入账固化为准）
- `winning_tickets_count`：中奖票数（按票抽奖；奖池按票平分；必须 ≤ `total_tickets`）
- `draw_at`：开奖时间（≥ 创建时间 + 1 小时）
- `ticket_price_usdc`：单张抽奖券价格（USDC 最小单位）
- `total_tickets`：抽奖券总数（v0 硬上限 ≤ 10,000）
- `min_tickets_to_draw`：最低开奖票数（未达标失败）
- `cover_image_url`：默认使用奖池代币的 icon；若获取失败则使用预设兜底图（创建时固化为最终值）
- `description`：描述（纯文本/Markdown）
  可选字段（v0）：
- `max_tickets_per_user`：单用户最多可购买数量（不填/为空表示不限制；若填写则必须 ≤ `total_tickets`）
  平台预设字段（不在表单中填写）：
- `platform_fee_wallet`：平台手续费钱包地址（后端预设）
  派生字段（不在表单中填写）：
- `prize_token_program_id`：由 `prize_mint` 链上 mint account 的 `owner` 推导（经典 Token Program 或 Token-2022）
- `sale_end_at`：售票截止时间（`draw_at - 2 分钟`）
- `draw_execute_at`：后台开奖执行时间（`draw_at + 1 分钟`）

## 6. 技术架构与实现要点

### 6.1 技术栈

- 前端：Next.js（App Router）+ TypeScript
- 后端（业务服务）：Hono（部署在 Render Web Service；可作为 Next Route Handlers 的中间层；对外提供 API）
- 签发服务（Signing Service）：Hono（独立 Render Web Service；仅供业务服务内部调用；持有托管私钥并负责构建/partial sign 出金交易）
- 数据库：Render PostgreSQL
- 缓存/冷却：Render KV
- Solana：`@solana/web3.js` + `@solana/spl-token`
- 钱包：Solana wallet adapter
- 资产查询：Moralis Solana API（仅在点击 Load Assets 时请求）
- 网络：Demo 始终跑 Mainnet（由 `SOLANA_RPC_URL/USDC_MINT` 等 env 控制）
- RPC（建议）：Mainnet 为降低超时/限流导致的“校验不到账/领取失败”，建议接入更稳定的 RPC 服务商（例如 Zan 等）

### 6.2 Helius Raw Webhook 自动入账 + 链上校验（生产必选）

本项目仍以“**链上校验**”为资金安全基础；Webhook 仅用于把“链上已发生的入账事件”自动送达后端，减少依赖用户回传 `txSignature` 带来的漏记与争议。

- Webhook：使用 Helius Raw Transaction Webhook（确认级别固定 `finalized`）监听所有 raffle 的 `usdc_vault/prize_vault`（token account 地址）
  - 地址上限（v0 口径）：
    - Dashboard 创建的 webhook 最多 25 个地址；通过 API 更新单个 webhook 最多 100,000 个地址
    - 每新增 1 个 raffle 会新增 2 个地址（`usdc_vault` + `prize_vault`），因此单 webhook 理论可覆盖约 50,000 个 raffle（v0 demo 足够）
  - 地址列表更新：v0 可在 `POST /api/raffles/:id/vaults` 时直接调用 API 追加地址；地址列表更新通常是计费/限频点，若后续更新频率变高可再改为批量合并更新
  - 请求校验：必须校验共享密钥（建议使用请求头 `X-WEBHOOK-SECRET: <HELIUS_WEBHOOK_SECRET>`）并做强幂等（同一 `signature` 只处理一次；允许重复/乱序投递但不产生副作用）
  - 回滚口径（v0）：由于确认级别选 `finalized`，默认不处理链上回滚；若出现供应商误投递/极端回滚导致台账异常，以人工对账修正为准（demo 先不做复杂运维）
- 处理逻辑（收到 raw 交易后）：
  - 仅处理 `meta.err == null` 的成功交易
  - 用 `preTokenBalances/postTokenBalances` 计算 `usdc_vault/prize_vault` 的净入账（post-pre），避免依赖指令金额，兼容 Token-2022 扣费
  - 购票支付（USDC）匹配条件：
    - mint 必须为 `USDC_MINT`
    - 收款账户必须为该 raffle 的 `usdc_vault`，且其 owner（token authority）为托管钱包
    - 金额必须等于该订单 `expected_amount_usdc`
    - 必须校验 `Memo=order_id` 并绑定到唯一订单（避免用“别的订单/别的场景”的入账误记票）
    - 付款方必须为订单 `buyer_wallet`
    - 过期判定：以 `block_time <= expires_at && block_time <= sale_end_at` 判定是否按时；若 raw 交易缺失 `block_time`，用 `slot -> getBlockTime(slot)` 补齐；若仍缺失则延迟重试（至少在 `draw_execute_at` 前完成最终归类）
  - 奖池存入（prize token）匹配条件：
    - raffle 必须仍为 `DRAFT`
    - mint 必须为 `prize_mint`
    - 收款账户必须为该 raffle 的 `prize_vault`，且其 owner（token authority）为托管钱包
    - 不强依赖“指令转账金额”：以该交易中 `prize_vault` 的净入账（post-pre）作为 `prize_amount` 的最终值（兼容 Token-2022 的转账扣费等情况）；要求净入账 > 0
    - 付款方必须为 `creator_wallet`（避免他人误打导致 raffle 被激活；也避免“替他人完成存入确认”的争议）
- 补漏与兜底：
  - 保留“用户补交 `txSignature`”入口：用于 webhook 延迟/丢投时的手动触发确认
  - 后端对近期活跃 vault 做 backfill 补漏（建议每 10 分钟一次）：用于覆盖 webhook 重试失败/宕机窗口
    - 范围控制：仅对“可能产生入账”的 vault（例如 `DRAFT/ACTIVE`，以及刚 `resolved` 的短窗口）执行，避免全量扫描
    - 增量游标：每个 vault 记录 `last_seen_signature/slot`，只拉取游标之后的新签名
    - 限额与并发：每次任务对单 vault 拉取数量设上限（例如 20~50），整体并发受控，避免成本失控
    - 强幂等：以 `signature` 作为唯一键落库，重复回放不产生重复记票/重复确认

> 说明：用户绕开前端直接给 vault 转账（直转）仍不会自动记票/退款；但会被 webhook 落库为 `UNMATCHED` 入账，用于对账与后续人工处理。

### 6.3 “用户自付 gas”的托管出金（部分签名交易）

实现要点：

- 私钥隔离：托管私钥仅存放在签发服务；业务服务不持有私钥，对外出金相关 API 由业务服务提供，内部调用签发服务生成交易
- 调用鉴权：业务服务 -> 签发服务必须校验共享密钥（建议请求头 `X-SIGNER-SECRET: <SIGNER_SECRET>`），签发服务仅暴露必要路由
- 签发服务签名前必须锁定“收款人/金额/mint/来源 token account（raffle vault）”，用户只能补签与作为 fee payer
  - 建议口径：签发服务只接受 `payout_id`（与 `action`）并从 DB 读取参数，避免允许调用方传入任意 `to/mint/amount`
- `recentBlockhash` 有时效：前端需处理“交易过期请重试”，签发服务可重新签发
- 强幂等：同一笔退款/领奖/结算动作使用唯一 `idempotency_key`，避免重复签发导致多次转出
- v0 暂不实现“一键领取/打包多指令”，先按单 raffle / 单动作逐笔生成领取交易，降低交易体积与失败概率
- 转账指令建议统一使用 `transferChecked`（显式传入 decimals，并使用 mint 对应的 token program），避免“单位/精度”误用导致的链上校验失败
- 出金交易建议包含“为收款方创建 ATA（若不存在）”的幂等指令（同样需要使用 mint 对应的 token program），再执行转账，降低首次领取失败率
- “重签”必须受控：同一 `idempotency_key` 只允许重签同一笔意图（金额/收款方/mint/source 不变），且重签前需确认旧 `tx_signature` 未在链上成功（至少 `finalized`）

### 6.4 Load Assets（Moralis）按需加载与冷却

- 前端：Create 页面提供 `Load Assets` 按钮；未点击时不触发 Moralis
- 后端：对 `wallet` 做 5 分钟冷却（KV 记录下一次允许时间）
- 返回结构：代币列表（mint、symbol、decimals、余额、logo/metadata、`token_program_id`）+ 是否判定为 pump.fun 发行（v0 可简化）
  - `token_program_id`：建议由后端通过 RPC 读取 mint account 的 `owner` 推导（不依赖 Moralis 返回）

> pump.fun 判定（v0 Demo 取舍）：采用启发式过滤：仅允许 `mint` 地址后四位为 `pump` 的代币参与创建抽奖（不做链上归属证明；存在被伪造风险，Demo 可接受）。v0 不提供“手动输入 mint”兜底，以避免绕过过滤规则。

### 6.5 Token Program 兼容（Token Program / Token-2022）

v0 目标：支持 `prize_mint` 为经典 Token Program 或 Token-2022，并保证 Creator 可以把代币存入 `prize_vault`（奖池存入流程可用）。

实现口径（建议）：

- 识别：以链上 mint account 的 `owner` 作为该 mint 的 `token_program_id`（经典 Token Program 或 Token-2022），并落库到 `raffles.prize_token_program_id`
- 创建 `prize_vault`：
  - 必须使用 `raffles.prize_token_program_id` 对应的指令初始化 token account
  - Token-2022 的 token account `space/rent` 可能大于经典 token account：创建时需按该 mint 计算所需空间，再计算 rent
- 校验 `confirm-prize-deposit`：以 `prize_vault` 的净入账作为最终 `prize_amount`，避免因 Token-2022 转账扣费造成“链上成功但校验失败”
- 约束（v0）：不额外适配 Token-2022 的复杂扩展；若因代币扩展导致“无法用标准转账完成存入/后续出金”，则该 mint 视为不支持用于抽奖

## 7. 状态机（链下）

- `DRAFT`：已创建记录但未完成奖池存入校验
- `ACTIVE`：售票中
- `SUCCEEDED`：达到开奖条件，已生成中奖结果（允许领奖 + 允许 Creator 领取票款收入 + 允许平台费归集）
- `FAILED`：未达最低票数（允许退款 + 允许发起者取回奖池）
- `CLOSED`：关键资产处理完或超时关闭（可选）

强约束：

- `SUCCEEDED` 前禁止领取票款收入（失败需要全额退款）
- `FAILED` 后禁止领奖与票款收入领取
- `ACTIVE` 之外禁止确认购票支付与记票（无论来自 webhook 还是用户补交 `txSignature`）；入账确认逻辑需与开奖任务共享同一行锁策略，避免并发导致“开奖结果漂移/多记票”
- 同一笔 `payout` 最多成功一次（由 `idempotency_key` 与 DB 状态保证）
- 用户/Creator 可发起的出金动作必须在 `claim_deadline_at` 前发起；过期后禁止签发对应出金交易（可选：由后台任务将 raffle 标记为 `CLOSED` 并从列表隐藏）
- DRAFT 过期处理（v0 建议）：超过一定时间仍未完成奖池存入校验（无 `prize_deposit_sig`）的 `DRAFT` 不建议直接删除（避免“链上已存入但未确认”导致资产孤儿）；可标记为过期并从列表隐藏，但需保留 `prize_vault/usdc_vault` 与“补交/重新校验 txSignature”的入口
- 关键写入需原子：开奖的“状态变更 + winners 落库”、购票确认的“订单状态 + 票数台账（sold/reserved/participants）”应在同一 DB 事务内完成，避免中间态造成不可恢复的卡死

## 8. 数据模型（建议）

> 金额字段统一用字符串存储最小单位（避免 JS number 精度问题）。

最小表（Postgres）：

- `raffles`
  - `id`, `status`
  - `creator_wallet`
  - `platform_fee_wallet`（创建时写入，来源于后端配置）
  - `prize_token_program_id`（`prize_mint` 对应的 token program；经典 Token Program 或 Token-2022）
  - `prize_mint`, `prize_amount`（以 `confirm-prize-deposit` 的 `prize_vault` 净入账固化为最终值）, `prize_decimals`
  - `ticket_price_usdc`, `total_tickets`, `max_tickets_per_user`, `min_tickets_to_draw`
  - `winning_tickets_count`, `draw_at`
  - `cover_image_url`, `description`
  - `prize_vault`, `usdc_vault`（每个 raffle 独立 vault token account；owner 为托管钱包；降低并发写锁热点；仍需 DB 台账保证幂等与额度正确）
  - `prize_deposit_sig`, `sold_tickets`, `reserved_tickets`
  - `resolved_at`（进入 `SUCCEEDED/FAILED` 的时间）
  - `claim_deadline_at`（=`resolved_at + 30 天`；过期后资产无法领取）
  - `created_at`, `updated_at`
- `orders`（购票订单）
  - `id`, `raffle_id`, `buyer_wallet`
  - `qty`, `expected_amount_usdc`
  - `expires_at`
  - `release_at`（= `expires_at + release_grace`，用于后端释放预占；建议创建订单时固化）
  - `pay_sig`（唯一）, `status`（RESERVED/PAID/EXPIRED/REJECTED_PAID）
  - `created_at`
  - 状态语义（v0 建议）：
    - `RESERVED`：已预占，等待用户支付（由 webhook 自动确认；用户也可补交 `txSignature` 触发重试）
    - `PAID`：链上校验通过且已记票
    - `EXPIRED`：超过 `release_at` 仍未成功记票，已释放预占
    - `REJECTED_PAID`：该订单支付链上校验通过，但因过期/余票不足/订单已释放等导致不记票；允许用户自助退款（资金从 `usdc_vault` 退回买家钱包；用户自付 gas）
  - 说明：若用户提交的 `txSignature` 链上校验不通过（wrong mint/收款 vault/金额/Memo/付款方等），后端应直接拒绝并返回错误，不应写入 `pay_sig`、不应改变订单状态（允许用户重新提交正确的 signature）
- `inbound_transfers`（入账流水：用于 webhook 自动记账与对账）
  - `id`
  - `signature`（唯一）
  - `vault`（`usdc_vault/prize_vault`）
  - `mint`, `amount`
  - `from_wallet`（付款方）
  - `memo`（用于绑定订单：`Memo=order_id`）
  - `slot`, `block_time`
  - `type`（ORDER_PAYMENT/PRIZE_DEPOSIT/UNMATCHED）
  - `status`（RECEIVED/MATCHED/IGNORED）
  - `matched_order_id`, `matched_raffle_id`（可选）
- `participants`
  - `raffle_id`, `buyer_wallet`（唯一）
  - `tickets_bought`, `tickets_reserved`, `tickets_refunded`
- `winners`
  - `raffle_id`, `winner_wallet`（唯一）
  - `winning_tickets`, `claimed_tickets`
  - `prize_amount_each_ticket`, `claimed_at`
- `payouts`（所有可提现动作的幂等记录）
  - `id`
  - `raffle_id`
  - `type`（REFUND/ORDER_REFUND/PRIZE/SETTLE/RETURN_PRIZE/PLATFORM_FEE）
  - `wallet`, `mint`, `amount`
  - `idempotency_key`（唯一）
  - `tx_signature`, `status`, `created_at`

Render KV：

- `moralis:cooldown:<pubkey>`：下一次允许点击 `Load Assets` 的时间戳
- `moralis:wallet:<pubkey>`：资产列表缓存（TTL=5min）
- `signing:paused`：手动暂停签发开关（`true/false`）
  - 单一数据源（v0 口径）：以 Render KV 的 `signing:paused` 作为唯一开关；`/api/admin/signing/pause|resume` 只写 KV
  - 校验位置：业务服务所有出金相关接口（返回 tx 的接口）与签发服务在处理请求前都应先读 KV，并在 `true` 时直接拒绝
  - 性能：签发服务可做 2~5 秒本地缓存降低 KV 读取，但需保证“暂停/恢复”最大生效延迟可控（≤ 缓存 TTL）

## 9. API 设计（建议）

认证：除 webhook 回调与 `/api/admin/*` 外，写操作均要求钱包登录（签名登录会话）；webhook 与管理员接口使用共享密钥鉴权。
签发服务：仅供业务服务内部调用，使用共享密钥鉴权（建议请求头 `X-SIGNER-SECRET: <SIGNER_SECRET>`），不直接对前端暴露。
签发服务内部接口约定（v0 建议最小集）：

- `POST /internal/payouts/:id/sign-tx`：对指定 `payout_id` 生成“由托管钱包签名的交易”（base64）
  - 请求头：`X-SIGNER-SECRET: <SIGNER_SECRET>`
  - 请求体：`{ "action"?: "SIGN" | "RESIGN" }`（默认 `SIGN`；`RESIGN` 仅用于 blockhash 过期重签同一意图）
  - 入参约束：签发服务只接受 `payout_id`（与 `action`），并从 DB 读取 `payouts` + 关联 `raffles` 推导 `wallet/mint/amount/source_vault/fee_payer/type/idempotency_key/claim_deadline_at/...`，不允许调用方传入任意 `to/mint/amount`（降低被滥用/误用风险）
  - 签名口径：用户侧的退款/领奖/结算为 partial sign（需要用户补签并作为 fee payer）；平台费归集为 fully signed（托管钱包作为 fee payer，可由业务服务直接 `sendRawTransaction` 提交）
  - 返回：`{ "tx_base64": string, "recent_blockhash": string }`
  - 失败口径（建议）：
    - `401`：`SIGNER_SECRET` 校验失败
    - `409`：`signing:paused=true` / payout 状态不允许 / 幂等冲突（例如已成功）
    - `422`：业务校验失败（例如过期、金额为 0、来源 vault 不匹配等）
    - `500`：RPC/构建交易/签名等内部错误

- `GET /api/raffles`：主页列表（支持分页/筛选；返回基础字段与状态）
- `GET /api/raffles/:id`：抽奖详情（返回抽奖配置、当前进度、用户可操作入口所需字段）
- `POST /api/auth/siws`：签名登录
- `POST /api/assets/load`：执行 Load Assets（含 5 分钟冷却；返回每个 mint 的 `token_program_id`）
- `POST /api/webhooks/helius`：Helius Raw Webhook 回调入口（校验共享密钥：`X-WEBHOOK-SECRET: <HELIUS_WEBHOOK_SECRET>`；按 `signature` 幂等去重；解析入账并触发记票/确认存入）
- `POST /api/raffles`：创建抽奖（DRAFT；写入 `prize_token_program_id`）
- `POST /api/raffles/:id/vaults`：注册 raffle 的 `usdc_vault/prize_vault`（仅 raffle=`DRAFT` 且 `creator_wallet` 登录；写入 DB，并将 vault 地址加入 webhook 监听列表）
- `POST /api/raffles/:id/confirm-prize-deposit`：确认奖池存入（仅允许 raffle=`DRAFT`；校验 `prize_vault/usdc_vault` 与奖池转账；以 `prize_vault` 净入账固化最终 `prize_amount`；转 ACTIVE；应幂等。通常由 webhook 触发，前端提交 `txSignature` 时也可用于补交/重试）
- `POST /api/raffles/:id/orders`：创建购票订单（返回 `expires_at/release_at`）
- `POST /api/orders/:id/pay-tx`：返回该订单的购票支付交易（base64，未签名；包含 `USDC_MINT` → `usdc_vault` 的精确金额转账 + `Memo=order_id`；`recentBlockhash` 过期可重复获取）
- `POST /api/orders/:id/confirm-payment`：确认购票支付并记票（仅允许 raffle=`ACTIVE`；校验转账至 `usdc_vault`；以链上 `blockTime` 判定 `blockTime <= expires_at && blockTime <= sale_end_at`；若链上校验通过但过期/余票不足等导致不记票，则标记 `REJECTED_PAID` 并允许用户自助退款；应幂等。通常由 webhook 触发，前端提交 `txSignature` 时也可用于补交/重试）
- `POST /api/orders/:id/reject-refund-tx`：返回该订单的自助退款部分签名交易（仅订单=`REJECTED_PAID`；退回 `expected_amount_usdc`；用户自付 gas；内部调用签发服务 partial sign）
- `POST /api/admin/draw-due`：后台任务，处理到期抽奖（必须校验 `CRON_SECRET`，建议使用请求头 `X-CRON-SECRET: <CRON_SECRET>`；与 webhook 入账确认/`confirm-payment` 共享行锁策略）
- `POST /api/admin/backfill-vaults`：后台任务，增量 backfill 近期活跃 vault（建议每 10 分钟调用一次，用于补漏 webhook；必须校验 `CRON_SECRET`；按 `signature` 强幂等；需范围控制与限额）
- `POST /api/admin/sweep-platform-fees`：后台任务，归集所有可领取的平台费到平台手续费钱包（必须校验 `CRON_SECRET`；托管钱包作为 signer + fee payer；逐笔执行，强幂等；内部调用签发服务完成签名）
- `POST /api/admin/signing/pause`：手动暂停签发所有出金交易（必须校验 `CRON_SECRET`；写 `signing:paused=true`）
- `POST /api/admin/signing/resume`：恢复签发（必须校验 `CRON_SECRET`；写 `signing:paused=false`）
- `POST /api/raffles/:id/claim-prize-tx`：返回中奖用户领奖的部分签名交易（按其未领取中奖票数计算金额；内部调用签发服务 partial sign）
- `POST /api/raffles/:id/refund-tx`：返回 buyer 退款的部分签名交易（内部调用签发服务 partial sign）
- `POST /api/raffles/:id/return-prize-tx`：返回 Creator 取回奖池的部分签名交易（仅 FAILED；全额或剩余未取回部分；内部调用签发服务 partial sign）
- `POST /api/raffles/:id/settle-tx`：返回 Creator 领取票款收入（USDC，92%）的部分签名交易（仅 SUCCEEDED；内部调用签发服务 partial sign）
- `POST /api/tx/submit-result`：前端提交链上交易结果（claim/refund/settle 等），更新 DB 状态（应幂等；同一 `tx_signature` 重复提交不应产生副作用）

## 10. 安全与风控（Demo 级）

- 托管私钥仅存放在签发服务的 env：仅适合 Demo（热钱包）。要求：
  - 使用专用小额托管钱包，不长期留大额资产
  - 不在日志中输出任何私钥/助记词/序列化密钥
  - dev/staging/prod 分离密钥，必要时可轮换
- 私钥隔离：业务服务不持有托管私钥；签发服务仅提供出金交易签名能力，内部调用必须校验 `SIGNER_SECRET`（例如 `X-SIGNER-SECRET` 请求头）。v0 Demo 可采用“公网可访问但仅供业务服务调用”的部署方式：签发服务不对前端暴露、仅保留必要路由、只接受 `payout_id` 并从 DB 二次校验出金参数；本阶段先不做额外限流（后续可再补来源限制/限流）
- 托管钱包与平台手续费钱包均由平台自持与管理，不依赖第三方托管；签发服务持有托管热钱包私钥用于签发出金交易
- 平台手续费钱包：服务器仅需要配置地址（收款不需要私钥）；私钥建议由平台离线保管，避免与托管热钱包同等暴露面
- 资产隔离：v0 为每个 raffle 创建独立 vault token account（owner 仍为托管钱包）；跨 raffle 不共享同一个 source token account，降低并发写锁冲突；仍需 DB 台账保证幂等与额度正确
- 严格校验：所有入账确认必须校验 mint/收款 vault/付款方签名者；金额按规则校验（USDC 购票为精确金额；奖池存入以 `prize_vault` 净入账为准）
- Webhook 安全：Helius 回调必须校验共享密钥（自定义 header），并按 `signature` 幂等去重（允许重复投递但不产生副作用）
- 幂等：所有出金动作必须绑定 `idempotency_key` 并落库
- 紧急止血：支持项目方手动暂停/恢复“出金交易签发”（`signing:paused`），暂停期间签发服务直接拒绝所有签发请求
- v0 托管钱包数量：demo 阶段默认仅使用 1 个托管钱包（后续可按第 13 节轮换/扩展）
- 平台费归集：由托管钱包作为 fee payer 上链，需要持续准备少量 SOL（否则定时归集会失败）
- `/api/admin/*`：必须带管理员密钥（`CRON_SECRET`；例如 `X-CRON-SECRET` 请求头）校验，避免被外部滥用触发开奖/重复执行

> 说明：v0 设置 `claim_deadline_at = resolved_at + 30 天`。平台需要至少在截止期内具备“为存量抽奖签发出金交易”的能力；这会影响托管密钥轮换策略（见第 13 节）。

## 11. 部署方案（Render）

- Render Web Service（业务服务 / App API）：
  - 运行 Next.js（前端 + API；API 内使用 Hono 路由）
  - 环境变量：
    - `SIGNER_SERVICE_URL`（签发服务地址）
    - `SIGNER_SECRET`（业务服务 -> 签发服务的共享密钥，对应请求头 `X-SIGNER-SECRET`）
    - `SOLANA_RPC_URL`
    - `MORALIS_API_KEY`
    - `HELIUS_API_KEY`（用于管理 webhook/必要的补漏校验）
    - `HELIUS_WEBHOOK_ID`（Helius Webhook ID）
    - `HELIUS_WEBHOOK_SECRET`（Webhook 共享密钥，用于回调鉴权；对应请求头 `X-WEBHOOK-SECRET`）
    - `USDC_MINT`
    - `PLATFORM_FEE_WALLET`（平台手续费钱包地址）
    - `CRON_SECRET`（定时任务/管理员接口密钥）
    - `ORDER_EXPIRES_SECONDS`（订单有效期，v0 默认 600）
    - `RELEASE_GRACE_SECONDS`（释放预占缓冲，v0 默认 120）
    - `CLAIM_DEADLINE_DAYS`（领取截止天数，v0 固定 30）
    - `DEFAULT_COVER_IMAGE_URL`（找不到 token icon 时的兜底封面图）
    - `DATABASE_URL`
    - `RENDER_KV_*`
- Render Web Service（签发服务 / Signing Service）：
  - 仅提供“出金交易构建 + 签名”接口（不对前端暴露；v0 Demo 可绑定公开域名但必须校验 `SIGNER_SECRET`，并尽量缩小暴露面）
  - 环境变量（最小建议）：
    - `CUSTODY_PRIVATE_KEY`（托管私钥，base58/base64 之一，按实现约定；仅此服务持有）
    - `SIGNER_SECRET`（共享密钥：校验业务服务的内部调用，对应请求头 `X-SIGNER-SECRET`）
    - `SOLANA_RPC_URL`
    - `DATABASE_URL`（用于读取出金参数并做二次校验）
    - `RENDER_KV_*`（读取 `signing:paused` 等开关）
- Render PostgreSQL：业务数据
- Render KV：缓存与冷却
- 定时任务：
  - 推荐：Render Cron Job 定时调用 `/api/admin/draw-due`
  - 推荐：Render Cron Job 每 10 分钟调用 `/api/admin/backfill-vaults`
  - 推荐：Render Cron Job 定时调用 `/api/admin/sweep-platform-fees`

Helius Webhook 配置与验证（v0 运行手册）：

- 配置项：
  - 回调 URL：业务服务 `POST /api/webhooks/helius`
  - 确认级别：`finalized`
  - 共享密钥：回调请求头 `X-WEBHOOK-SECRET: <HELIUS_WEBHOOK_SECRET>`
- 创建：
  - 创建 1 个 webhook（地址列表可先为空）
  - 记录 `HELIUS_WEBHOOK_ID`，配置 `HELIUS_WEBHOOK_SECRET`
- 更新（每新增 raffle）：
  - 在 `POST /api/raffles/:id/vaults` 成功后，通过 Helius API 将该 raffle 的 `usdc_vault` + `prize_vault` 追加到 webhook 地址列表（v0 先按“每次追加”实现；后续地址更新频率变高再改为批量合并更新）
- 验证：
  - 用一笔测试转账（打到 `usdc_vault`，并带 `Memo=order_id`）验证：后端能收到 webhook、落库 `inbound_transfers`，并且重复投递不会重复记票（`signature` 幂等）
- 排查（常见原因）：
  - `HELIUS_WEBHOOK_SECRET` 不一致（鉴权失败）
  - webhook 地址列表不包含该 vault（未追加/追加失败）
  - 已被幂等去重（同一 `signature` 重复投递属于正常现象）
  - 交易未 `finalized`（需等待确认或查看供应商投递延迟）

域名与 CDN（建议）：

- 使用 Cloudflare 做域名解析与代理（橙云），源站为 Render
- v0 不建议把 Next.js 直接迁到 Cloudflare Pages/Workers（会增加运行时兼容与鉴权/CORS 复杂度）；若后续需要全球边缘静态加速，可把“纯静态前端”拆到 Cloudflare Pages，API 仍留在 Render

## 12. MVP 验收清单

- 能连接钱包并完成签名登录
- `Load Assets`：仅点击才请求 Moralis；5 分钟冷却生效
- Creator：能创建抽奖并完成奖池存入校验（DRAFT → ACTIVE；创建出 `usdc_vault/prize_vault`；支持 webhook 自动确认）
- Buyer：能用 USDC 买票（订单预占 + 链上校验至 `usdc_vault` + 不超卖；`total_tickets` ≤ 10,000；`max_tickets_per_user` 若设置则生效）
- 自动入账：用户不提交 `txSignature` 也能被系统自动记票；入账无法匹配订单时落库为 `UNMATCHED`
- 若订单链上支付校验通过但不计票：订单为 `REJECTED_PAID`，用户可自助退款（用户自付 gas）
- 到点后：
  - 未达最低票数：FAILED，Buyer 可退款，Creator 可取回奖池
  - 达标：SUCCEEDED，生成中奖结果；中奖用户可按票领奖；Creator 可领取 92% 票款；平台费 8% 由后端定时归集到平台手续费钱包
- 退款/领奖/Creator 结算由用户作为 fee payer 自付手续费；平台费归集由托管钱包作为 fee payer 支付手续费
- 领取截止：`claim_deadline_at = resolved_at + 30 天`；过期后不再签发用户/Creator 出金交易（资产无法领取）
- 紧急止血：`/api/admin/signing/pause|resume` 可手动暂停/恢复签发；暂停期间签发服务拒绝签发，业务服务所有出金接口直接拒绝

## 13. 托管私钥轮换（可行方案）

目标：在“不写自定义合约”的前提下，允许平台逐步切换托管钱包，同时不影响存量抽奖的退款/领奖。

### 13.1 设计原则

- **新抽奖用新托管钱包**：轮换后，所有新创建的 raffle 只使用最新托管钱包收款/收奖池。
- **存量抽奖可迁移**：通过把“未分配/未领取的资金池”从旧托管钱包迁移到新托管钱包，实现旧私钥下线。
- **短交易有效期**：所有“部分签名交易”依赖 `recentBlockhash`，天然会在分钟级过期；迁移期间允许用户重试领取即可。

### 13.2 需要落库的最小信息

- 新增 `custody_wallets` 表（或配置文件）：
  - `id`, `public_key`, `status`（ACTIVE/DRAINING/RETIRED）, `created_at`
- `raffles.custody_wallet_id`：每个 raffle 绑定一个托管钱包（创建时写入）
- `payouts.custody_wallet_id`：每笔可领取动作绑定其托管钱包（生成时写入）

### 13.3 轮换流程（推荐）

1. 生成新托管钱包（`custody_v2`），把其私钥加入签发服务 env，标记为 `ACTIVE`
2. 将旧托管钱包（`custody_v1`）标记为 `DRAINING`：停止新 raffle 使用，但仍允许存量领取
3. 执行“迁移任务”（运维窗口内）：
   - 暂停对 `custody_v1` 签发新的领取交易（或仅允许查询）
   - 把 `custody_v1` 中属于“存量 raffle 未分配资金池”的余额（USDC + 各 prize mint 余量）转入 `custody_v2` 对应 token account（或对 vault token account 执行 SPL `SetAuthority` 将 owner 改为 `custody_v2`）
   - 更新 DB：将相关 `raffles/payouts` 的 `custody_wallet_id` 改为 `custody_v2`
4. 确认 `custody_v1` 余额为 0 后，将其标记为 `RETIRED` 并从签发服务在线 env 移除私钥（仅保留离线备份）

### 13.4 注意事项

- 迁移期间，用户手里若还保留了旧的“部分签名交易”，可能因余额变化而失败；前端提示重试并重新请求交易即可。
- 若后续放开为“不设置领取截止日期”，建议定期执行迁移，把存量 obligations 收敛到最新托管钱包，避免长期在线维护多把热钱包私钥。

## 14. 补充口径（v0 已明确）

- Helius Webhook：确认级别固定使用 `finalized`；投递语义按“至少一次”，后端以 `signature` 强幂等去重（允许重复/乱序投递）
- 链上回滚：v0 不实现“自动回滚记账/扣票/回退状态”；若出现供应商误投递/极端回滚导致台账异常，以人工对账修正为准（demo 先不做复杂运维）
- Webhook 地址上限：v0 使用 1 个 webhook，通过 API 维护地址列表；单 webhook 上限 100,000 个地址（Dashboard 仅 25）；每个 raffle 增加 2 个 vault 地址
- `claim_deadline_at`：固定为 `resolved_at + 30 天`；截止后不再签发出金交易，资产留在 vault（v0 暂不处置；包含 `REJECTED_PAID` 自助退款）
- backfill（长期跑 Demo 建议启用）：每 10 分钟对近期活跃 vault 增量补漏；按 vault 游标 + 拉取限额控制成本；以 `signature` 幂等保证可重复回放
- 签发服务部署（v0 决策）：选择“方案 B（公网可访问 + `SIGNER_SECRET` 鉴权）”，不对前端暴露、仅保留必要路由、只接收 `payout_id` 并从 DB 二次校验；本阶段先不做额外限流
- 测试策略（工程约束）：v0 不引入第三方测试框架，单测/集成测优先使用 Node 内置 `node:test`（后续实现阶段在仓库内补齐对应命令与用例）
