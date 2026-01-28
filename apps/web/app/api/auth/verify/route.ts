import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { issueSessionToken, setSessionCookie } from "@/src/auth/session";
import { normalizeWallet, verifySignature } from "@/src/auth/siws";
import { withClient } from "@/src/db/tx";

export const runtime = "nodejs";

type VerifyResult = {
  status: number;
  body: { ok?: true; wallet?: string; error?: string };
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeWallet(body?.wallet);
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature =
    typeof body?.signature_base64 === "string"
      ? body.signature_base64
      : typeof body?.signature === "string"
        ? body.signature
        : "";

  if (!wallet || !nonce || !signature) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let verifyResult: VerifyResult;
  try {
    verifyResult = await withClient(async (client) => {
      await client.query("BEGIN");
      const rollback = async (status: number, error: string): Promise<VerifyResult> => {
        await client.query("ROLLBACK");
        return { status, body: { error } };
      };

      const result = await client.query(
        `
          SELECT nonce, wallet, message, expires_at, consumed_at
          FROM auth_challenges
          WHERE nonce = $1
          FOR UPDATE;
        `,
        [nonce],
      );
      if (result.rowCount === 0) {
        return rollback(404, "challenge_not_found");
      }

      const challenge = result.rows[0] as {
        wallet: string;
        message: string;
        expires_at: Date;
        consumed_at: Date | null;
      };

      if (challenge.wallet !== wallet) {
        return rollback(400, "wallet_mismatch");
      }
      if (challenge.consumed_at) {
        return rollback(409, "challenge_used");
      }
      if (new Date(challenge.expires_at).getTime() <= Date.now()) {
        return rollback(410, "challenge_expired");
      }

      const ok = await verifySignature({
        wallet,
        message: challenge.message,
        signature,
      });
      if (!ok) {
        return rollback(401, "signature_invalid");
      }

      const update = await client.query(
        `
          UPDATE auth_challenges
          SET consumed_at = NOW()
          WHERE nonce = $1 AND consumed_at IS NULL;
        `,
        [nonce],
      );
      if (update.rowCount !== 1) {
        return rollback(409, "challenge_used");
      }

      await client.query("COMMIT");
      return { status: 200, body: { ok: true, wallet } };
    });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (verifyResult.status !== 200) {
    return NextResponse.json(verifyResult.body, { status: verifyResult.status });
  }

  const token = issueSessionToken({ wallet });
  const response = NextResponse.json(verifyResult.body);
  setSessionCookie(response, token);
  return response;
}
