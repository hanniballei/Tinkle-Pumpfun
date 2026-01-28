# 260127 - M3 创建抽奖闭环（DRAFT → ACTIVE）

## 背景
- 在完成 M2（SIWS 登录与鉴权）后，进入创建抽奖闭环的实现阶段。

## 目标与范围
- 创建 DRAFT raffle 并落库（含派生时间字段）。
- 注册 `usdc_vault/prize_vault` 并加入 Helius webhook 监听。
- 生成“创建 vault + 奖池存入”的未签名交易（前端签名上链）。
- 通过 `txSignature` 确认奖池存入并将 raffle 置为 ACTIVE。

## 阶段与 TODO
- [x] 数据库：新增 M3 字段迁移
- [x] Solana 工具：mint/账户大小/交易构建/入账解析
- [x] Helius：webhook 地址追加与去重
- [x] API：raffles 创建、注册 vault、生成存入交易、确认存入
- [x] 测试：单元 + 集成

## 约束与决策
- DRAFT 不删除，仅隐藏过期；保留补交 `txSignature` 复核入口。
- `prize_mint` 支持 Token Program / Token-2022。
- vault 地址先落库再加入 webhook 监听列表。

## 实现要点摘要
- 创建 DRAFT 时校验 pump.fun mint、票数规则与 `draw_at` 时间约束，写入派生字段 `sale_end_at/draw_execute_at/draft_expires_at`。
- vault 注册时强依赖 Helius：地址追加失败即返回错误并记录 `webhook_last_error`。
- 奖池存入确认以 `prize_vault` 净入账为准（post-pre），并在同一事务内落库入账与激活状态。

## 人工验收清单（待确认）
1. 登录后调用 `POST /api/raffles` 创建 DRAFT，返回字段完整且可落库。
2. 生成并注册 `prize_vault/usdc_vault`，Helius 地址追加成功。
3. 请求 `prize-deposit-tx` 获取 base64 交易并可签名上链。
4. 提交 `confirm-prize-deposit` 后 raffle 变为 `ACTIVE`，`prize_amount` 固化。
