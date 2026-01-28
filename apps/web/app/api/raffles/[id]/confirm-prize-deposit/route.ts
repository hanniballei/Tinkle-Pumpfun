import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireUser } from "@/src/auth/requireUser";
import { withClient } from "@/src/db/tx";
import { getSolanaConnection } from "@/src/solana/connection";
import { getMintDecimals } from "@/src/solana/mint";
import { parsePublicKey } from "@/src/solana/pubkey";
import { computeTokenNetAmount, extractAccountKeys } from "@/src/solana/txParse";
import { normalizeSignature } from "@/src/raffles/validators";

export const runtime = "nodejs";

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  const session = requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raffleId = context.params.id;
  const body = await req.json().catch(() => null);
  const signature = normalizeSignature(body?.tx_signature);
  if (!signature) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const connection = getSolanaConnection();

  let raffleRow: {
    id: string;
    status: string;
    creator_wallet: string;
    prize_mint: string;
    prize_token_program_id: string;
    prize_vault: string | null;
    prize_deposit_sig: string | null;
  } | null = null;

  try {
    const result = await withClient(async (client) => {
      const raffleResult = await client.query(
        `
          SELECT id, status, creator_wallet, prize_mint, prize_token_program_id, prize_vault, prize_deposit_sig
          FROM raffles
          WHERE id = $1
          FOR UPDATE;
        `,
        [raffleId],
      );
      if (raffleResult.rowCount === 0) {
        return { status: 404, body: { error: "raffle_not_found" } };
      }

      const row = raffleResult.rows[0] as typeof raffleRow;
      raffleRow = row;

      if (row.creator_wallet !== session.wallet) {
        return { status: 403, body: { error: "forbidden" } };
      }
      if (!row.prize_vault) {
        return { status: 409, body: { error: "vaults_missing" } };
      }

      if (row.status === "ACTIVE" && row.prize_deposit_sig === signature) {
        return { status: 200, body: { ok: true, status: "ACTIVE" } };
      }
      if (row.status !== "DRAFT") {
        return { status: 409, body: { error: "invalid_status" } };
      }

      return { status: 200, body: { ok: true } };
    });

    if (result.status !== 200) {
      return NextResponse.json(result.body, { status: result.status });
    }
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!raffleRow) {
    return NextResponse.json({ error: "raffle_not_found" }, { status: 404 });
  }

  const prizeVault = parsePublicKey(raffleRow.prize_vault ?? "");
  const prizeMint = parsePublicKey(raffleRow.prize_mint);
  const prizeTokenProgramId = parsePublicKey(raffleRow.prize_token_program_id);
  if (!prizeVault || !prizeMint || !prizeTokenProgramId) {
    return NextResponse.json({ error: "invalid_raffle_data" }, { status: 500 });
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
  const netAmount = computeTokenNetAmount({
    accountKeys,
    preTokenBalances: tx.meta.preTokenBalances ?? [],
    postTokenBalances: tx.meta.postTokenBalances ?? [],
    vault: prizeVault.toBase58(),
    mint: prizeMint.toBase58(),
  });
  if (netAmount <= 0n) {
    return NextResponse.json({ error: "no_prize_deposit" }, { status: 400 });
  }

  let prizeDecimals = 0;
  try {
    prizeDecimals = await getMintDecimals(connection, prizeMint, prizeTokenProgramId);
  } catch {
    return NextResponse.json({ error: "mint_fetch_failed" }, { status: 502 });
  }

  const slot = tx.slot;
  const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000) : null;

  const update = await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const existing = await client.query(
        `
          SELECT signature, matched_raffle_id
          FROM inbound_transfers
          WHERE signature = $1;
        `,
        [signature],
      );
      if (existing.rowCount > 0) {
        const matched = existing.rows[0].matched_raffle_id as string | null;
        if (matched && matched !== raffleId) {
          await client.query("ROLLBACK");
          return { status: 409, body: { error: "signature_conflict" } };
        }
      }

      await client.query(
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
            matched_raffle_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PRIZE_DEPOSIT', 'MATCHED', $9)
          ON CONFLICT (signature) DO NOTHING;
        `,
        [
          signature,
          prizeVault.toBase58(),
          prizeMint.toBase58(),
          netAmount.toString(),
          raffleRow.creator_wallet,
          null,
          slot,
          blockTime,
          raffleId,
        ],
      );

      await client.query(
        `
          UPDATE raffles
          SET
            status = 'ACTIVE',
            prize_amount = $1,
            prize_decimals = $2,
            prize_deposit_sig = $3,
            updated_at = NOW()
          WHERE id = $4;
        `,
        [netAmount.toString(), prizeDecimals, signature, raffleId],
      );

      await client.query("COMMIT");
      return { status: 200, body: { ok: true, status: "ACTIVE" } };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });

  return NextResponse.json(update.body, { status: update.status });
}
