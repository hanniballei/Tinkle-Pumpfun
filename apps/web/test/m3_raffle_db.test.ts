import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { withClient } from "../src/db/tx";

const hasDatabase = Boolean(process.env.DATABASE_URL);

if (!hasDatabase) {
  test("M3 raffles 数据库测试（缺少 DATABASE_URL，跳过）", { skip: true }, () => {});
} else {
  test("M3 raffles 字段可读写", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const raffleId = randomUUID();
        const now = new Date();
        const drawAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        const saleEndAt = new Date(drawAt.getTime() - 2 * 60 * 1000);
        const drawExecuteAt = new Date(drawAt.getTime() + 60 * 1000);

        await client.query(
          `
            INSERT INTO raffles (
              id,
              status,
              creator_wallet,
              platform_fee_wallet,
              prize_mint,
              ticket_price_usdc,
              total_tickets,
              min_tickets_to_draw,
              winning_tickets_count,
              draw_at,
              sale_end_at,
              draw_execute_at,
              draft_expires_at
            )
            VALUES (
              $1,
              'DRAFT',
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              $11,
              $12
            );
          `,
          [
            raffleId,
            "creator_wallet",
            "platform_wallet",
            "prize_mint",
            "100",
            100,
            10,
            5,
            drawAt,
            saleEndAt,
            drawExecuteAt,
            new Date(now.getTime() + 600 * 1000),
          ],
        );

        await client.query(
          `
            UPDATE raffles
            SET prize_vault = $1,
                usdc_vault = $2,
                webhook_registered_at = NOW(),
                webhook_last_error = NULL
            WHERE id = $3;
          `,
          ["prize_vault", "usdc_vault", raffleId],
        );

        const result = await client.query(
          `
            SELECT prize_vault, usdc_vault, webhook_registered_at
            FROM raffles
            WHERE id = $1;
          `,
          [raffleId],
        );
        assert.equal(result.rowCount, 1);
        assert.equal(result.rows[0].prize_vault, "prize_vault");
        assert.equal(result.rows[0].usdc_vault, "usdc_vault");
        assert.ok(result.rows[0].webhook_registered_at);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
}
