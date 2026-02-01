import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireUser } from "@/src/auth/requireUser";
import { withClient } from "@/src/db/tx";
import { requireEnv } from "@/src/env";
import { applyOrderPayment, OrderError } from "@/src/orders/service";
import { getSolanaConnection } from "@/src/solana/connection";
import { parsePublicKey } from "@/src/solana/pubkey";
import {
  computeTokenNetAmount,
  extractAccountKeys,
  extractMemo,
} from "@/src/solana/txParse";
import { normalizeSignature } from "@/src/raffles/validators";

export const runtime = "nodejs";

function isValidWebhook(req: NextRequest): boolean {
  const provided = req.headers.get("x-webhook-secret");
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  return Boolean(provided && expected && provided === expected);
}

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  const session = requireUser(req);
  const webhookAllowed = isValidWebhook(req);
  if (!session && !webhookAllowed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const signature = normalizeSignature(body?.tx_signature);
  if (!signature) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const orderId = context.params.id;
  const order = await withClient(async (client) => {
    const result = await client.query(
      `
        SELECT o.id, o.buyer_wallet, r.usdc_vault
        FROM orders o
        JOIN raffles r ON r.id = o.raffle_id
        WHERE o.id = $1;
      `,
      [orderId],
    );
    return result.rowCount ? result.rows[0] : null;
  });

  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  if (session && order.buyer_wallet !== session.wallet) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!order.usdc_vault) {
    return NextResponse.json({ error: "vault_missing" }, { status: 409 });
  }

  const connection = getSolanaConnection();
  const usdcMint = parsePublicKey(requireEnv("USDC_MINT"));
  const usdcVault = parsePublicKey(order.usdc_vault);
  if (!usdcMint || !usdcVault) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const tx = await connection.getTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || !tx.meta) {
    return NextResponse.json({ error: "tx_not_found" }, { status: 404 });
  }

  const accountKeys = extractAccountKeys(
    tx.transaction.message.accountKeys as { pubkey: string }[] | string[],
  );
  const memo = extractMemo({
    accountKeys,
    instructions: tx.transaction.message.instructions as Array<{
      programIdIndex: number;
      data: string;
    }>,
  });

  const netAmount = computeTokenNetAmount({
    accountKeys,
    preTokenBalances: tx.meta.preTokenBalances ?? [],
    postTokenBalances: tx.meta.postTokenBalances ?? [],
    vault: usdcVault.toBase58(),
    mint: usdcMint.toBase58(),
  });
  if (netAmount <= 0n) {
    return NextResponse.json({ error: "no_payment" }, { status: 400 });
  }

  let blockTime = tx.blockTime ? new Date(tx.blockTime * 1000) : null;
  if (!blockTime && tx.slot) {
    const fetched = await connection.getBlockTime(tx.slot);
    blockTime = fetched ? new Date(fetched * 1000) : null;
  }

  try {
    const result = await withClient((client) =>
      applyOrderPayment({
        client,
        orderId,
        expectedMint: usdcMint.toBase58(),
        expectedBuyerWallet: session?.wallet,
        evidence: {
          signature,
          memo,
          fromWallet: accountKeys[0] ?? null,
          vault: usdcVault.toBase58(),
          mint: usdcMint.toBase58(),
          amount: netAmount,
          slot: tx.slot ?? null,
          blockTime,
        },
      }),
    );

    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
