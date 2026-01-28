import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireUser } from "@/src/auth/requireUser";
import { withClient } from "@/src/db/tx";
import { requireEnv } from "@/src/env";
import { parsePositiveBigint } from "@/src/raffles/validators";
import { getSolanaConnection } from "@/src/solana/connection";
import { buildCreateVaultsAndDepositTx } from "@/src/solana/txBuilders";
import { parsePublicKey } from "@/src/solana/pubkey";

export const runtime = "nodejs";

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  const session = requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raffleId = context.params.id;
  const raffle = await withClient(async (client) => {
    const result = await client.query(
      `
        SELECT
          id,
          status,
          creator_wallet,
          prize_mint,
          prize_amount,
          prize_token_program_id,
          prize_vault,
          usdc_vault,
          webhook_registered_at
        FROM raffles
        WHERE id = $1;
      `,
      [raffleId],
    );
    return result.rowCount ? result.rows[0] : null;
  });

  if (!raffle) {
    return NextResponse.json({ error: "raffle_not_found" }, { status: 404 });
  }
  if (raffle.creator_wallet !== session.wallet) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (raffle.status !== "DRAFT") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }
  if (!raffle.prize_vault || !raffle.usdc_vault) {
    return NextResponse.json({ error: "vaults_missing" }, { status: 409 });
  }
  if (!raffle.webhook_registered_at) {
    return NextResponse.json({ error: "webhook_not_ready" }, { status: 409 });
  }

  const prizeMint = parsePublicKey(raffle.prize_mint);
  const prizeTokenProgramId = parsePublicKey(raffle.prize_token_program_id);
  const prizeVault = parsePublicKey(raffle.prize_vault);
  const usdcVault = parsePublicKey(raffle.usdc_vault);
  if (!prizeMint || !prizeTokenProgramId || !prizeVault || !usdcVault) {
    return NextResponse.json({ error: "invalid_raffle_data" }, { status: 500 });
  }

  const prizeAmount = parsePositiveBigint(raffle.prize_amount);
  if (!prizeAmount) {
    return NextResponse.json({ error: "invalid_prize_amount" }, { status: 400 });
  }

  const custodyWallet = parsePublicKey(requireEnv("CUSTODY_WALLET_PUBLIC_KEY"));
  if (!custodyWallet) {
    return NextResponse.json({ error: "invalid_custody_wallet" }, { status: 500 });
  }

  const usdcMint = parsePublicKey(requireEnv("USDC_MINT"));
  if (!usdcMint) {
    return NextResponse.json({ error: "invalid_usdc_mint" }, { status: 500 });
  }

  const creatorWallet = parsePublicKey(session.wallet);
  if (!creatorWallet) {
    return NextResponse.json({ error: "invalid_creator_wallet" }, { status: 500 });
  }

  try {
    const result = await buildCreateVaultsAndDepositTx({
      connection: getSolanaConnection(),
      creatorWallet,
      custodyWallet,
      prizeMint,
      prizeTokenProgramId,
      usdcMint,
      prizeAmount,
      prizeVault,
      usdcVault,
    });

    return NextResponse.json({
      tx_base64: result.txBase64,
      blockhash: result.blockhash,
      last_valid_block_height: result.lastValidBlockHeight,
      prize_vault: prizeVault.toBase58(),
      usdc_vault: usdcVault.toBase58(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "tx_build_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
