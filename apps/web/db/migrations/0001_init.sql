-- v0 Demo 最小表结构（按 PRD.md 的“数据模型（建议）”）
-- 约定：金额字段统一用 TEXT 存最小单位（避免 JS number 精度问题）

-- 记录已执行的 migration（由 runner 自动创建，但这里也兼容手动执行）
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raffles (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUCCEEDED', 'FAILED', 'CLOSED')),
  creator_wallet TEXT NOT NULL,
  platform_fee_wallet TEXT NOT NULL,
  prize_token_program_id TEXT,
  prize_mint TEXT NOT NULL,
  prize_amount TEXT,
  prize_decimals INT,
  ticket_price_usdc TEXT NOT NULL,
  total_tickets INT NOT NULL,
  max_tickets_per_user INT,
  min_tickets_to_draw INT NOT NULL,
  winning_tickets_count INT NOT NULL,
  draw_at TIMESTAMPTZ NOT NULL,
  sale_end_at TIMESTAMPTZ NOT NULL,
  draw_execute_at TIMESTAMPTZ NOT NULL,
  cover_image_url TEXT,
  description TEXT,
  prize_vault TEXT,
  usdc_vault TEXT,
  prize_deposit_sig TEXT,
  sold_tickets INT NOT NULL DEFAULT 0,
  reserved_tickets INT NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  claim_deadline_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles (status);
CREATE INDEX IF NOT EXISTS idx_raffles_draw_execute_at ON raffles (draw_execute_at);
CREATE INDEX IF NOT EXISTS idx_raffles_creator_wallet ON raffles (creator_wallet);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  raffle_id UUID NOT NULL REFERENCES raffles (id) ON DELETE CASCADE,
  buyer_wallet TEXT NOT NULL,
  qty INT NOT NULL,
  expected_amount_usdc TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  release_at TIMESTAMPTZ NOT NULL,
  pay_sig TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('RESERVED', 'PAID', 'EXPIRED', 'REJECTED_PAID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_raffle_id ON orders (raffle_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_wallet ON orders (buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_release_at ON orders (release_at);

CREATE TABLE IF NOT EXISTS inbound_transfers (
  id BIGSERIAL PRIMARY KEY,
  signature TEXT NOT NULL UNIQUE,
  vault TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount TEXT NOT NULL,
  from_wallet TEXT NOT NULL,
  memo TEXT,
  slot BIGINT,
  block_time TIMESTAMPTZ,
  type TEXT NOT NULL CHECK (type IN ('ORDER_PAYMENT', 'PRIZE_DEPOSIT', 'UNMATCHED')),
  status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'MATCHED', 'IGNORED')),
  matched_order_id UUID REFERENCES orders (id) ON DELETE SET NULL,
  matched_raffle_id UUID REFERENCES raffles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbound_transfers_vault ON inbound_transfers (vault);
CREATE INDEX IF NOT EXISTS idx_inbound_transfers_created_at ON inbound_transfers (created_at);
CREATE INDEX IF NOT EXISTS idx_inbound_transfers_matched_raffle_id ON inbound_transfers (matched_raffle_id);

CREATE TABLE IF NOT EXISTS participants (
  raffle_id UUID NOT NULL REFERENCES raffles (id) ON DELETE CASCADE,
  buyer_wallet TEXT NOT NULL,
  tickets_bought INT NOT NULL DEFAULT 0,
  tickets_reserved INT NOT NULL DEFAULT 0,
  tickets_refunded INT NOT NULL DEFAULT 0,
  PRIMARY KEY (raffle_id, buyer_wallet)
);

CREATE TABLE IF NOT EXISTS winners (
  raffle_id UUID NOT NULL REFERENCES raffles (id) ON DELETE CASCADE,
  winner_wallet TEXT NOT NULL,
  winning_tickets INT NOT NULL,
  claimed_tickets INT NOT NULL DEFAULT 0,
  prize_amount_each_ticket TEXT NOT NULL,
  claimed_at TIMESTAMPTZ,
  PRIMARY KEY (raffle_id, winner_wallet)
);

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY,
  raffle_id UUID NOT NULL REFERENCES raffles (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  tx_signature TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_raffle_id ON payouts (raffle_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts (status);

