import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireUser } from "@/src/auth/requireUser";
import { withClient } from "@/src/db/tx";
import { reserveOrder, OrderError } from "@/src/orders/service";
import { parsePositiveInt } from "@/src/raffles/validators";

export const runtime = "nodejs";

function readPositiveSeconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  const session = requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const qty = parsePositiveInt(body?.qty);
  if (!qty) {
    return NextResponse.json({ error: "invalid_qty" }, { status: 400 });
  }

  const ttlSeconds = readPositiveSeconds(process.env.ORDER_EXPIRES_SECONDS, 600);
  const graceSeconds = readPositiveSeconds(process.env.RELEASE_GRACE_SECONDS, 120);

  try {
    const result = await withClient((client) =>
      reserveOrder({
        client,
        raffleId: context.params.id,
        buyerWallet: session.wallet,
        qty,
        ttlSeconds,
        graceSeconds,
      }),
    );

    return NextResponse.json({
      id: result.orderId,
      raffle_id: result.raffleId,
      qty: result.qty,
      expected_amount_usdc: result.expectedAmountUsdc,
      expires_at: result.expiresAt.toISOString(),
      release_at: result.releaseAt.toISOString(),
      status: "RESERVED",
    });
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
