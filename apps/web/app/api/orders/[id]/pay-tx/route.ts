import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireUser } from "@/src/auth/requireUser";
import { withClient } from "@/src/db/tx";
import { requireEnv } from "@/src/env";
import { buildOrderPaymentTx } from "@/src/solana/txBuilders";
import { getSolanaConnection } from "@/src/solana/connection";
import { parsePublicKey } from "@/src/solana/pubkey";

export const runtime = "nodejs";

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  const session = requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const orderId = context.params.id;
  const order = await withClient(async (client) => {
    const result = await client.query(
      `
        SELECT
          o.id,
          o.raffle_id,
          o.buyer_wallet,
          o.qty,
          o.expected_amount_usdc,
          o.expires_at,
          o.status,
          r.status AS raffle_status,
          r.usdc_vault
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
  if (order.buyer_wallet !== session.wallet) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (order.status !== "RESERVED") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }
  if (order.raffle_status !== "ACTIVE") {
    return NextResponse.json({ error: "raffle_inactive" }, { status: 409 });
  }
  if (!order.usdc_vault) {
    return NextResponse.json({ error: "vault_missing" }, { status: 409 });
  }

  const now = new Date();
  if (now.getTime() >= new Date(order.expires_at).getTime()) {
    return NextResponse.json({ error: "order_expired" }, { status: 409 });
  }

  const buyerWallet = parsePublicKey(session.wallet);
  const usdcMint = parsePublicKey(requireEnv("USDC_MINT"));
  const usdcVault = parsePublicKey(order.usdc_vault);
  if (!buyerWallet || !usdcMint || !usdcVault) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await buildOrderPaymentTx({
      connection: getSolanaConnection(),
      buyerWallet,
      usdcMint,
      usdcVault,
      amount: BigInt(order.expected_amount_usdc),
      memo: order.id,
    });

    return NextResponse.json({
      order_id: order.id,
      tx_base64: result.txBase64,
      blockhash: result.blockhash,
      last_valid_block_height: result.lastValidBlockHeight,
      expected_amount_usdc: order.expected_amount_usdc,
      usdc_vault: order.usdc_vault,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "tx_build_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
