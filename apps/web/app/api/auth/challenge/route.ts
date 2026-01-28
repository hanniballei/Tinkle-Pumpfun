import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createChallenge, normalizeWallet, resolveAuthDomain } from "@/src/auth/siws";
import { withClient } from "@/src/db/tx";

export const runtime = "nodejs";

const CHALLENGE_TTL_SECONDS = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeWallet(body?.wallet);
  if (!wallet) {
    return NextResponse.json({ error: "invalid_wallet" }, { status: 400 });
  }

  const domain = resolveAuthDomain(req.headers);
  const challenge = createChallenge({
    wallet,
    domain,
    ttlSeconds: CHALLENGE_TTL_SECONDS,
  });

  await withClient(async (client) => {
    await client.query(
      `
        INSERT INTO auth_challenges (nonce, wallet, message, expires_at)
        VALUES ($1, $2, $3, $4);
      `,
      [challenge.nonce, challenge.wallet, challenge.message, challenge.expiresAt],
    );
  });

  return NextResponse.json({
    nonce: challenge.nonce,
    message: challenge.message,
    issued_at: challenge.issuedAt.toISOString(),
    expires_at: challenge.expiresAt.toISOString(),
  });
}
