-- M3：DRAFT 过期与 webhook 注册字段
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS draft_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_raffles_draft_expires_at
  ON raffles (draft_expires_at);

CREATE INDEX IF NOT EXISTS idx_raffles_draft_hidden_at
  ON raffles (draft_hidden_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_raffles_prize_vault_unique
  ON raffles (prize_vault)
  WHERE prize_vault IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_raffles_usdc_vault_unique
  ON raffles (usdc_vault)
  WHERE usdc_vault IS NOT NULL;
