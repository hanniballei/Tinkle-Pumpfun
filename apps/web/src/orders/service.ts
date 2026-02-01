import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { computeOrderExpiresAt, computeReleaseAt } from "./rules";

export class OrderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export type ReserveOrderResult = {
  orderId: string;
  raffleId: string;
  qty: number;
  expectedAmountUsdc: string;
  expiresAt: Date;
  releaseAt: Date;
};

export async function reserveOrder(params: {
  client: PoolClient;
  raffleId: string;
  buyerWallet: string;
  qty: number;
  now?: Date;
  ttlSeconds: number;
  graceSeconds: number;
  manageTransaction?: boolean;
}): Promise<ReserveOrderResult> {
  const now = params.now ?? new Date();
  const qty = params.qty;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new OrderError("invalid_qty", 400);
  }

  const manageTransaction = params.manageTransaction ?? true;
  if (manageTransaction) {
    await params.client.query("BEGIN");
  }
  try {
    const raffleResult = await params.client.query(
      `
        SELECT
          id,
          status,
          ticket_price_usdc,
          total_tickets,
          sold_tickets,
          reserved_tickets,
          max_tickets_per_user,
          sale_end_at
        FROM raffles
        WHERE id = $1
        FOR UPDATE;
      `,
      [params.raffleId],
    );

    if (raffleResult.rowCount === 0) {
      throw new OrderError("raffle_not_found", 404);
    }

    const raffle = raffleResult.rows[0] as {
      id: string;
      status: string;
      ticket_price_usdc: string;
      total_tickets: number;
      sold_tickets: number;
      reserved_tickets: number;
      max_tickets_per_user: number | null;
      sale_end_at: Date;
    };

    if (raffle.status !== "ACTIVE") {
      throw new OrderError("invalid_status", 409);
    }

    if (now.getTime() >= new Date(raffle.sale_end_at).getTime()) {
      throw new OrderError("sale_ended", 409);
    }

    const remaining =
      raffle.total_tickets - raffle.sold_tickets - raffle.reserved_tickets;
    if (remaining < qty) {
      throw new OrderError("insufficient_tickets", 409);
    }

    const participantResult = await params.client.query(
      `
        SELECT tickets_bought, tickets_reserved
        FROM participants
        WHERE raffle_id = $1 AND buyer_wallet = $2
        FOR UPDATE;
      `,
      [params.raffleId, params.buyerWallet],
    );

    const participant = participantResult.rowCount
      ? (participantResult.rows[0] as {
          tickets_bought: number;
          tickets_reserved: number;
        })
      : null;

    if (raffle.max_tickets_per_user) {
      const owned =
        (participant?.tickets_bought ?? 0) + (participant?.tickets_reserved ?? 0);
      if (owned + qty > raffle.max_tickets_per_user) {
        throw new OrderError("max_tickets_exceeded", 409);
      }
    }

    const expectedAmount = BigInt(raffle.ticket_price_usdc) * BigInt(qty);
    const expiresAt = computeOrderExpiresAt({
      now,
      saleEndAt: raffle.sale_end_at,
      ttlSeconds: params.ttlSeconds,
    });
    const releaseAt = computeReleaseAt({
      expiresAt,
      graceSeconds: params.graceSeconds,
    });

    const orderId = randomUUID();
    await params.client.query(
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
        raffle.id,
        params.buyerWallet,
        qty,
        expectedAmount.toString(),
        expiresAt,
        releaseAt,
      ],
    );

    await params.client.query(
      `
        UPDATE raffles
        SET reserved_tickets = reserved_tickets + $1, updated_at = NOW()
        WHERE id = $2;
      `,
      [qty, raffle.id],
    );

    await params.client.query(
      `
        INSERT INTO participants (raffle_id, buyer_wallet, tickets_reserved)
        VALUES ($1, $2, $3)
        ON CONFLICT (raffle_id, buyer_wallet) DO UPDATE
        SET tickets_reserved = participants.tickets_reserved + EXCLUDED.tickets_reserved;
      `,
      [raffle.id, params.buyerWallet, qty],
    );

    if (manageTransaction) {
      await params.client.query("COMMIT");
    }
    return {
      orderId,
      raffleId: raffle.id,
      qty,
      expectedAmountUsdc: expectedAmount.toString(),
      expiresAt,
      releaseAt,
    };
  } catch (err) {
    if (manageTransaction) {
      await params.client.query("ROLLBACK");
    }
    throw err;
  }
}

export type PaymentEvidence = {
  signature: string;
  memo: string | null;
  fromWallet: string | null;
  vault: string;
  mint: string;
  amount: bigint;
  slot: number | null;
  blockTime: Date | null;
};

export type ApplyPaymentResult = {
  status: "PAID" | "REJECTED_PAID";
  alreadyProcessed: boolean;
};

export async function applyOrderPayment(params: {
  client: PoolClient;
  orderId: string;
  evidence: PaymentEvidence;
  expectedMint: string;
  expectedBuyerWallet?: string;
  manageTransaction?: boolean;
}): Promise<ApplyPaymentResult> {
  const manageTransaction = params.manageTransaction ?? true;
  if (manageTransaction) {
    await params.client.query("BEGIN");
  }
  try {
    const orderResult = await params.client.query(
      `
        SELECT
          o.id,
          o.raffle_id,
          o.buyer_wallet,
          o.qty,
          o.expected_amount_usdc,
          o.expires_at,
          o.pay_sig,
          o.status AS order_status,
          r.status AS raffle_status,
          r.total_tickets,
          r.sold_tickets,
          r.reserved_tickets,
          r.sale_end_at,
          r.usdc_vault
        FROM orders o
        JOIN raffles r ON r.id = o.raffle_id
        WHERE o.id = $1
        FOR UPDATE OF o, r;
      `,
      [params.orderId],
    );

    if (orderResult.rowCount === 0) {
      throw new OrderError("order_not_found", 404);
    }

    const order = orderResult.rows[0] as {
      id: string;
      raffle_id: string;
      buyer_wallet: string;
      qty: number;
      expected_amount_usdc: string;
      expires_at: Date;
      pay_sig: string | null;
      order_status: string;
      raffle_status: string;
      total_tickets: number;
      sold_tickets: number;
      reserved_tickets: number;
      sale_end_at: Date;
      usdc_vault: string | null;
    };

    if (params.expectedBuyerWallet && order.buyer_wallet !== params.expectedBuyerWallet) {
      throw new OrderError("forbidden", 403);
    }

    if (order.pay_sig && order.pay_sig !== params.evidence.signature) {
      throw new OrderError("signature_conflict", 409);
    }

    if (
      order.pay_sig === params.evidence.signature &&
      (order.order_status === "PAID" || order.order_status === "REJECTED_PAID")
    ) {
      if (manageTransaction) {
        await params.client.query("COMMIT");
      }
      return {
        status: order.order_status as "PAID" | "REJECTED_PAID",
        alreadyProcessed: true,
      };
    }

    if (order.raffle_status !== "ACTIVE") {
      throw new OrderError("invalid_status", 409);
    }

    if (!order.usdc_vault) {
      throw new OrderError("vault_missing", 409);
    }

    if (params.evidence.vault !== order.usdc_vault) {
      throw new OrderError("vault_mismatch", 400);
    }
    if (params.evidence.mint !== params.expectedMint) {
      throw new OrderError("mint_mismatch", 400);
    }

    if (!params.evidence.memo || params.evidence.memo !== params.orderId) {
      throw new OrderError("memo_mismatch", 409);
    }

    if (params.evidence.fromWallet && params.evidence.fromWallet !== order.buyer_wallet) {
      throw new OrderError("buyer_mismatch", 403);
    }

    if (!params.evidence.blockTime) {
      throw new OrderError("block_time_missing", 409);
    }

    const expectedAmount = BigInt(order.expected_amount_usdc);
    if (params.evidence.amount !== expectedAmount) {
      throw new OrderError("amount_mismatch", 400);
    }

    const signatureCheck = await params.client.query(
      `
        SELECT signature, matched_order_id
        FROM inbound_transfers
        WHERE signature = $1;
      `,
      [params.evidence.signature],
    );
    if (signatureCheck.rowCount > 0) {
      const matched = signatureCheck.rows[0].matched_order_id as string | null;
      if (matched && matched !== params.orderId) {
        throw new OrderError("signature_conflict", 409);
      }
    }

    const isOnTime =
      params.evidence.blockTime.getTime() <= new Date(order.expires_at).getTime() &&
      params.evidence.blockTime.getTime() <= new Date(order.sale_end_at).getTime();

    let shouldAccept = isOnTime;
    if (order.order_status === "EXPIRED") {
      const remaining = order.total_tickets - order.sold_tickets - order.reserved_tickets;
      if (remaining < order.qty) {
        shouldAccept = false;
      }
    } else if (order.order_status !== "RESERVED") {
      shouldAccept = false;
    }

    const nextStatus: "PAID" | "REJECTED_PAID" = shouldAccept ? "PAID" : "REJECTED_PAID";

    await params.client.query(
      `
        UPDATE orders
        SET status = $1, pay_sig = $2, updated_at = NOW()
        WHERE id = $3;
      `,
      [nextStatus, params.evidence.signature, order.id],
    );

    if (nextStatus === "PAID") {
      if (order.order_status === "RESERVED") {
        await params.client.query(
          `
            UPDATE raffles
            SET sold_tickets = sold_tickets + $1,
                reserved_tickets = reserved_tickets - $1,
                updated_at = NOW()
            WHERE id = $2;
          `,
          [order.qty, order.raffle_id],
        );
      } else {
        await params.client.query(
          `
            UPDATE raffles
            SET sold_tickets = sold_tickets + $1, updated_at = NOW()
            WHERE id = $2;
          `,
          [order.qty, order.raffle_id],
        );
      }

      await params.client.query(
        `
          INSERT INTO participants (raffle_id, buyer_wallet, tickets_bought, tickets_reserved)
          VALUES ($1, $2, $3, 0)
          ON CONFLICT (raffle_id, buyer_wallet) DO UPDATE
          SET tickets_bought = participants.tickets_bought + EXCLUDED.tickets_bought,
              tickets_reserved = GREATEST(participants.tickets_reserved - $4, 0);
        `,
        [order.raffle_id, order.buyer_wallet, order.qty, order.qty],
      );
    } else {
      if (order.order_status === "RESERVED") {
        await params.client.query(
          `
            UPDATE raffles
            SET reserved_tickets = reserved_tickets - $1, updated_at = NOW()
            WHERE id = $2;
          `,
          [order.qty, order.raffle_id],
        );
        await params.client.query(
          `
            UPDATE participants
            SET tickets_reserved = GREATEST(tickets_reserved - $1, 0)
            WHERE raffle_id = $2 AND buyer_wallet = $3;
          `,
          [order.qty, order.raffle_id, order.buyer_wallet],
        );
      }
    }

    await params.client.query(
      `
        INSERT INTO inbound_transfers (
          signature,
          vault,
          mint,
          amount,
          from_wallet,
          memo,
          slot,
          block_time,
          type,
          status,
          matched_order_id,
          matched_raffle_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ORDER_PAYMENT', 'MATCHED', $9, $10)
        ON CONFLICT (signature) DO NOTHING;
      `,
      [
        params.evidence.signature,
        params.evidence.vault,
        params.evidence.mint,
        params.evidence.amount.toString(),
        params.evidence.fromWallet ?? order.buyer_wallet,
        params.evidence.memo,
        params.evidence.slot,
        params.evidence.blockTime,
        order.id,
        order.raffle_id,
      ],
    );

    if (manageTransaction) {
      await params.client.query("COMMIT");
    }
    return { status: nextStatus, alreadyProcessed: false };
  } catch (err) {
    if (manageTransaction) {
      await params.client.query("ROLLBACK");
    }
    throw err;
  }
}

export async function releaseExpiredOrders(params: {
  client: PoolClient;
  now?: Date;
  limit: number;
  manageTransaction?: boolean;
}): Promise<number> {
  const now = params.now ?? new Date();

  const manageTransaction = params.manageTransaction ?? true;
  if (manageTransaction) {
    await params.client.query("BEGIN");
  }
  try {
    const result = await params.client.query(
      `
        SELECT id, raffle_id, qty, buyer_wallet
        FROM orders
        WHERE status = 'RESERVED' AND release_at <= $1
        ORDER BY release_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED;
      `,
      [now, params.limit],
    );

    for (const row of result.rows as Array<{
      id: string;
      raffle_id: string;
      qty: number;
      buyer_wallet: string;
    }>) {
      await params.client.query(
        `
          UPDATE orders
          SET status = 'EXPIRED', updated_at = NOW()
          WHERE id = $1 AND status = 'RESERVED';
        `,
        [row.id],
      );
      await params.client.query(
        `
          UPDATE raffles
          SET reserved_tickets = reserved_tickets - $1, updated_at = NOW()
          WHERE id = $2;
        `,
        [row.qty, row.raffle_id],
      );
      await params.client.query(
        `
          UPDATE participants
          SET tickets_reserved = GREATEST(tickets_reserved - $1, 0)
          WHERE raffle_id = $2 AND buyer_wallet = $3;
        `,
        [row.qty, row.raffle_id, row.buyer_wallet],
      );
    }

    if (manageTransaction) {
      await params.client.query("COMMIT");
    }
    return result.rowCount;
  } catch (err) {
    if (manageTransaction) {
      await params.client.query("ROLLBACK");
    }
    throw err;
  }
}
