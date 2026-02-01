# 260201 M4 购票闭环实现

## 目标
- 实现购票核心接口：创建订单、生成支付交易、确认支付、释放预占。
- 与 PRD 规则一致：预占、过期释放、按链上 `blockTime` 判定是否按时、幂等确认。
- 补齐单元测试与集成测试（Node 内置 `node:test`）。

## 范围
- apps/web API 与业务逻辑
- 新增订单相关工具函数与测试

## 非目标
- 前端页面与交互
- Webhook/backfill（M7）

## 阶段计划（含 TODO）
- [x] S1：订单规则与工具函数
  - [x] 新增订单过期/释放时间计算
  - [x] 新增 Memo 解析工具
  - [x] 新增支付交易构建函数
- [x] S2：API 与业务逻辑
  - [x] `POST /api/raffles/:id/orders`
  - [x] `POST /api/orders/:id/pay-tx`
  - [x] `POST /api/orders/:id/confirm-payment`
  - [x] `POST /api/admin/release-reserved`
- [x] S3：测试与验证
  - [x] 单测：订单时间规则 / Memo 解析
  - [x] 集成测：订单预占 + 支付确认路径

## 验证记录
- `npm run format:check`
- `npm run lint`
- `PGSSLMODE=require npm run test`

## 风险与注意
- 事务与行锁：避免预占与确认并发导致超卖或台账错误
- 支付确认幂等：按 `signature` 去重
- `blockTime` 缺失：必要时用 `slot -> getBlockTime(slot)` 补齐
