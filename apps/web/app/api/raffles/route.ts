import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireUser } from "@/src/auth/requireUser";
import { requireEnv } from "@/src/env";
import { withClient } from "@/src/db/tx";
import {
  computeDraftExpiresAt,
  computeDrawExecuteAt,
  computeSaleEndAt,
  isPumpFunMint,
  MAX_TOTAL_TICKETS,
  DRAW_AT_MIN_HOURS,
} from "@/src/raffles/rules";
import {
  parseIsoDate,
  parseOptionalInt,
  parsePositiveBigint,
  parsePositiveInt,
} from "@/src/raffles/validators";
import { getSolanaConnection } from "@/src/solana/connection";
import { getMintDecimals, getTokenProgramIdForMint } from "@/src/solana/mint";
import { parsePublicKey } from "@/src/solana/pubkey";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const prizeMintInput = typeof body?.prize_mint === "string" ? body.prize_mint : "";
  const prizeMintKey = parsePublicKey(prizeMintInput);
  if (!prizeMintKey) {
    return NextResponse.json({ error: "invalid_prize_mint" }, { status: 400 });
  }
  if (!isPumpFunMint(prizeMintInput)) {
    return NextResponse.json({ error: "invalid_pump_mint" }, { status: 400 });
  }

  const prizeAmount = parsePositiveBigint(body?.prize_amount);
  const ticketPrice = parsePositiveBigint(body?.ticket_price_usdc);
  const totalTickets = parsePositiveInt(body?.total_tickets);
  const minTicketsToDraw = parsePositiveInt(body?.min_tickets_to_draw);
  const winningTicketsCount = parsePositiveInt(body?.winning_tickets_count);
  const maxTicketsPerUser = parseOptionalInt(body?.max_tickets_per_user);
  const drawAt = parseIsoDate(body?.draw_at);

  if (
    !prizeAmount ||
    !ticketPrice ||
    !totalTickets ||
    !minTicketsToDraw ||
    !winningTicketsCount ||
    !drawAt
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (totalTickets > MAX_TOTAL_TICKETS) {
    return NextResponse.json({ error: "total_tickets_exceeded" }, { status: 400 });
  }
  if (winningTicketsCount > totalTickets) {
    return NextResponse.json({ error: "winning_tickets_exceeded" }, { status: 400 });
  }
  if (minTicketsToDraw > totalTickets) {
    return NextResponse.json({ error: "min_tickets_exceeded" }, { status: 400 });
  }
  if (minTicketsToDraw < winningTicketsCount) {
    return NextResponse.json({ error: "min_tickets_too_low" }, { status: 400 });
  }
  if (maxTicketsPerUser && maxTicketsPerUser > totalTickets) {
    return NextResponse.json({ error: "max_tickets_exceeded" }, { status: 400 });
  }

  const now = new Date();
  const minDrawAt = new Date(now.getTime() + DRAW_AT_MIN_HOURS * 60 * 60 * 1000);
  if (drawAt.getTime() < minDrawAt.getTime()) {
    return NextResponse.json({ error: "draw_at_too_soon" }, { status: 400 });
  }

  const saleEndAt = computeSaleEndAt(drawAt);
  const drawExecuteAt = computeDrawExecuteAt(drawAt);
  const ttlRaw = Number(process.env.DRAFT_EXPIRES_SECONDS ?? "600");
  const ttlSeconds = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 600;
  const draftExpiresAt = computeDraftExpiresAt({
    now,
    saleEndAt,
    ttlSeconds,
  });

  const description = typeof body?.description === "string" ? body.description : null;
  const coverImageUrl =
    typeof body?.cover_image_url === "string" && body.cover_image_url
      ? body.cover_image_url
      : process.env.DEFAULT_COVER_IMAGE_URL ?? null;

  const connection = getSolanaConnection();
  let prizeTokenProgramId;
  let prizeDecimals;
  try {
    prizeTokenProgramId = await getTokenProgramIdForMint(connection, prizeMintKey);
    prizeDecimals = await getMintDecimals(connection, prizeMintKey, prizeTokenProgramId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid_mint";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const platformFeeWallet = requireEnv("PLATFORM_FEE_WALLET");

  const raffleId = randomUUID();
  await withClient(async (client) => {
    await client.query(
      `
        INSERT INTO raffles (
          id,
          status,
          creator_wallet,
          platform_fee_wallet,
          prize_token_program_id,
          prize_mint,
          prize_amount,
          prize_decimals,
          ticket_price_usdc,
          total_tickets,
          max_tickets_per_user,
          min_tickets_to_draw,
          winning_tickets_count,
          draw_at,
          sale_end_at,
          draw_execute_at,
          cover_image_url,
          description,
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
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18
        );
      `,
      [
        raffleId,
        session.wallet,
        platformFeeWallet,
        prizeTokenProgramId.toBase58(),
        prizeMintKey.toBase58(),
        prizeAmount.toString(),
        prizeDecimals,
        ticketPrice.toString(),
        totalTickets,
        maxTicketsPerUser,
        minTicketsToDraw,
        winningTicketsCount,
        drawAt,
        saleEndAt,
        drawExecuteAt,
        coverImageUrl,
        description,
        draftExpiresAt,
      ],
    );
  });

  return NextResponse.json({
    id: raffleId,
    status: "DRAFT",
    draw_at: drawAt.toISOString(),
    sale_end_at: saleEndAt.toISOString(),
    draw_execute_at: drawExecuteAt.toISOString(),
    draft_expires_at: draftExpiresAt.toISOString(),
  });
}
