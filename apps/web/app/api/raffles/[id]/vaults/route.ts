import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireUser } from "@/src/auth/requireUser";
import { withClient } from "@/src/db/tx";
import { requireEnv } from "@/src/env";
import { appendHeliusWebhookAddresses } from "@/src/helius/webhook";
import { parsePublicKey } from "@/src/solana/pubkey";

export const runtime = "nodejs";

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  const session = requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raffleId = context.params.id;
  const body = await req.json().catch(() => null);
  const prizeVaultInput = typeof body?.prize_vault === "string" ? body.prize_vault : "";
  const usdcVaultInput = typeof body?.usdc_vault === "string" ? body.usdc_vault : "";

  const prizeVaultKey = parsePublicKey(prizeVaultInput);
  const usdcVaultKey = parsePublicKey(usdcVaultInput);
  if (!prizeVaultKey || !usdcVaultKey) {
    return NextResponse.json({ error: "invalid_vaults" }, { status: 400 });
  }
  if (prizeVaultKey.equals(usdcVaultKey)) {
    return NextResponse.json({ error: "vaults_must_differ" }, { status: 400 });
  }

  const result = await withClient(async (client) => {
    const raffle = await client.query(
      `
        SELECT id, creator_wallet, status, prize_vault, usdc_vault, webhook_registered_at
        FROM raffles
        WHERE id = $1
        FOR UPDATE;
      `,
      [raffleId],
    );
    if (raffle.rowCount === 0) {
      return { status: 404, body: { error: "raffle_not_found" } };
    }

    const row = raffle.rows[0] as {
      creator_wallet: string;
      status: string;
      prize_vault: string | null;
      usdc_vault: string | null;
      webhook_registered_at: Date | null;
    };

    if (row.creator_wallet !== session.wallet) {
      return { status: 403, body: { error: "forbidden" } };
    }
    if (row.status !== "DRAFT") {
      return { status: 409, body: { error: "invalid_status" } };
    }

    const existingPrize = row.prize_vault;
    const existingUsdc = row.usdc_vault;
    const sameAsExisting =
      existingPrize === prizeVaultKey.toBase58() &&
      existingUsdc === usdcVaultKey.toBase58();

    if (existingPrize || existingUsdc) {
      if (!sameAsExisting) {
        return { status: 409, body: { error: "vaults_conflict" } };
      }
      return {
        status: 200,
        body: {
          prize_vault: existingPrize,
          usdc_vault: existingUsdc,
          webhook_registered_at: row.webhook_registered_at?.toISOString() ?? null,
          need_webhook: row.webhook_registered_at === null,
        },
      };
    }

    await client.query(
      `
        UPDATE raffles
        SET prize_vault = $1, usdc_vault = $2, updated_at = NOW()
        WHERE id = $3;
      `,
      [prizeVaultKey.toBase58(), usdcVaultKey.toBase58(), raffleId],
    );

    return {
      status: 200,
      body: {
        prize_vault: prizeVaultKey.toBase58(),
        usdc_vault: usdcVaultKey.toBase58(),
        webhook_registered_at: null,
        need_webhook: true,
      },
    };
  });

  if (result.status !== 200) {
    return NextResponse.json(result.body, { status: result.status });
  }

  if (!result.body.need_webhook) {
    return NextResponse.json(result.body);
  }

  const apiKey = requireEnv("HELIUS_API_KEY");
  const webhookId = requireEnv("HELIUS_WEBHOOK_ID");

  try {
    await appendHeliusWebhookAddresses({
      apiKey,
      webhookId,
      addresses: [result.body.prize_vault, result.body.usdc_vault],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "helius_failed";
    await withClient(async (client) => {
      await client.query(
        `
          UPDATE raffles
          SET webhook_last_error = $1, updated_at = NOW()
          WHERE id = $2;
        `,
        [message, raffleId],
      );
    });
    return NextResponse.json({ error: "helius_failed" }, { status: 502 });
  }

  await withClient(async (client) => {
    await client.query(
      `
        UPDATE raffles
        SET webhook_registered_at = NOW(), webhook_last_error = NULL, updated_at = NOW()
        WHERE id = $1;
      `,
      [raffleId],
    );
  });

  return NextResponse.json({
    prize_vault: result.body.prize_vault,
    usdc_vault: result.body.usdc_vault,
    webhook_registered_at: new Date().toISOString(),
  });
}
