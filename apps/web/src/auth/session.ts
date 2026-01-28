import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { requireEnv } from "../env";

type SessionPayload = {
  sub: string;
  iat: number;
  exp: number;
};

const SESSION_COOKIE_NAME = "pf_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function issueSessionToken(params: { wallet: string; now?: Date }): string {
  const now = params.now ?? new Date();
  const payload: SessionPayload = {
    sub: params.wallet,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS,
  };
  return signJwt(payload, requireEnv("AUTH_JWT_SECRET"));
}

export function getSessionFromRequest(req: NextRequest): { wallet: string } | null {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifyJwt(token, requireEnv("AUTH_JWT_SECRET"));
  if (!payload) return null;
  return { wallet: payload.sub };
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function signJwt(payload: SessionPayload, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();
  const encodedSignature = base64urlEncode(signature);
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

function verifyJwt(token: string, secret: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac("sha256", secret).update(signingInput).digest();
  const actualSignature = base64urlDecode(encodedSignature);
  if (!actualSignature || actualSignature.length !== expectedSignature.length)
    return null;
  if (!timingSafeEqual(actualSignature, expectedSignature)) return null;

  const payloadBuffer = base64urlDecode(encodedPayload);
  if (!payloadBuffer) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(payloadBuffer.toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }

  if (typeof payload.sub !== "string") return null;
  if (typeof payload.exp !== "number") return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds >= payload.exp) return null;
  return payload;
}

function base64urlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function base64urlDecode(input: string): Buffer | null {
  try {
    return Buffer.from(input, "base64url");
  } catch {
    return null;
  }
}
