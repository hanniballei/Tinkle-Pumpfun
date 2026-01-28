import type { Connection, PublicKey } from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccountLen,
  getExtensionTypes,
  getMint,
} from "@solana/spl-token";

type MintWithExtensions = {
  tlvData?: Uint8Array;
};

export async function getTokenAccountSpaceForMint(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey,
): Promise<number> {
  if (programId.equals(TOKEN_PROGRAM_ID)) {
    return ACCOUNT_SIZE;
  }

  if (!programId.equals(TOKEN_2022_PROGRAM_ID)) {
    return ACCOUNT_SIZE;
  }

  const mintInfo = (await getMint(
    connection,
    mint,
    "confirmed",
    programId,
  )) as MintWithExtensions;

  if (!mintInfo.tlvData) {
    return ACCOUNT_SIZE;
  }

  const extensionTypes = getExtensionTypes(mintInfo.tlvData);
  return getAccountLen(extensionTypes);
}
