import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export async function getTokenProgramIdForMint(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, { commitment: "confirmed" });
  if (!info) {
    throw new Error("mint_not_found");
  }
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error("unsupported_mint_program");
}

export async function getMintDecimals(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey,
): Promise<number> {
  const mintInfo = await getMint(connection, mint, "confirmed", programId);
  return mintInfo.decimals;
}
