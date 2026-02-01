import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { withClient } from "../src/db/tx";
import {
  applyOrderPayment,
  reserveOrder,
  releaseExpiredOrders,
} from "../src/orders/service";

const hasDatabase = Boolean(process.env.DATABASE_URL);

if (!hasDatabase) {
  test("订单流程数据库测试（缺少 DATABASE_URL，跳过）", { skip: true }, () => {});
} else {
  test("订单预占 + 支付确认", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const raffleId = randomUUID();
        const drawAt = new Date("2026-02-01T02:00:00.000Z");
        const saleEndAt = new Date("2026-02-01T01:58:00.000Z");
        const drawExecuteAt = new Date("2026-02-01T02:01:00.000Z");

        const usdcVault = `usdc_vault_${raffleId}`;

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
              usdc_vault
            )
            VALUES (
              $1,
              'ACTIVE',
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
            10,
            1,
            1,
            drawAt,
            saleEndAt,
            drawExecuteAt,
            usdcVault,
          ],
        );

        const order = await reserveOrder({
          client,
          raffleId,
          buyerWallet: "buyer_wallet",
          qty: 2,
          now: new Date("2026-02-01T00:00:00.000Z"),
          ttlSeconds: 600,
          graceSeconds: 120,
          manageTransaction: false,
        });

        const signature = `sig_${order.orderId}`;
        const payment = await applyOrderPayment({
          client,
          orderId: order.orderId,
          expectedMint: "usdc_mint",
          evidence: {
            signature,
            memo: order.orderId,
            fromWallet: "buyer_wallet",
            vault: usdcVault,
            mint: "usdc_mint",
            amount: BigInt(order.expectedAmountUsdc),
            slot: 100,
            blockTime: new Date("2026-02-01T00:03:00.000Z"),
          },
          manageTransaction: false,
        });

        assert.equal(payment.status, "PAID");

        const orderRow = await client.query(
          `
            SELECT status, pay_sig
            FROM orders
            WHERE id = $1;
          `,
          [order.orderId],
        );
        assert.equal(orderRow.rows[0].status, "PAID");
        assert.equal(orderRow.rows[0].pay_sig, signature);

        const raffleRow = await client.query(
          `
            SELECT sold_tickets, reserved_tickets
            FROM raffles
            WHERE id = $1;
          `,
          [raffleId],
        );
        assert.equal(raffleRow.rows[0].sold_tickets, 2);
        assert.equal(raffleRow.rows[0].reserved_tickets, 0);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  test("释放过期预占订单", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const raffleId = randomUUID();
        const drawAt = new Date("2026-02-01T02:00:00.000Z");
        const saleEndAt = new Date("2026-02-01T01:58:00.000Z");
        const drawExecuteAt = new Date("2026-02-01T02:01:00.000Z");

        const usdcVault = `usdc_vault_${raffleId}`;

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
              usdc_vault,
              reserved_tickets
            )
            VALUES (
              $1,
              'ACTIVE',
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
              $12,
              $13
            );
          `,
          [
            raffleId,
            "creator_wallet",
            "platform_wallet",
            "prize_mint",
            "100",
            10,
            1,
            1,
            drawAt,
            saleEndAt,
            drawExecuteAt,
            usdcVault,
            1,
          ],
        );

        const orderId = randomUUID();
        await client.query(
          `
            INSERT INTO orders (
              id,
              raffle_id,
              buyer_wallet,
              qty,
              expected_amount_usdc,
              expires_at,
              release_at,
              status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'RESERVED');
          `,
          [
            orderId,
            raffleId,
            "buyer_wallet",
            1,
            "100",
            new Date("2026-02-01T00:01:00.000Z"),
            new Date("2026-02-01T00:03:00.000Z"),
          ],
        );

        await client.query(
          `
            INSERT INTO participants (raffle_id, buyer_wallet, tickets_reserved)
            VALUES ($1, $2, $3);
          `,
          [raffleId, "buyer_wallet", 1],
        );

        const released = await releaseExpiredOrders({
          client,
          now: new Date("2026-02-01T00:10:00.000Z"),
          limit: 10,
          manageTransaction: false,
        });

        assert.equal(released, 1);

        const orderRow = await client.query(
          `
            SELECT status
            FROM orders
            WHERE id = $1;
          `,
          [orderId],
        );
        assert.equal(orderRow.rows[0].status, "EXPIRED");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
}
