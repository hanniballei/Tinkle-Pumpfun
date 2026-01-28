import type { Connection, PublicKey } from "@solana/web3.js";
import { SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createInitializeAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

import { getSolanaConnection } from "./connection";
import { getTokenAccountSpaceForMint } from "./tokenAccount";

export type PrizeDepositTxResult = {
  txBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

export async function buildCreateVaultsAndDepositTx(params: {
  connection?: Connection;
  creatorWallet: PublicKey;
  custodyWallet: PublicKey;
  prizeMint: PublicKey;
  prizeTokenProgramId: PublicKey;
  usdcMint: PublicKey;
  prizeAmount: bigint;
  prizeVault: PublicKey;
  usdcVault: PublicKey;
}): Promise<PrizeDepositTxResult> {
  const connection = params.connection ?? getSolanaConnection();
  if (params.prizeAmount <= 0n) {
    throw new Error("invalid_prize_amount");
  }

  const prizeAccountSpace = await getTokenAccountSpaceForMint(
    connection,
    params.prizeMint,
    params.prizeTokenProgramId,
  );
  const prizeRent = await connection.getMinimumBalanceForRentExemption(
    prizeAccountSpace,
  );

  const usdcAccountSpace = 165;
  const usdcRent = await connection.getMinimumBalanceForRentExemption(
    usdcAccountSpace,
  );

  const creatorAta = await getAssociatedTokenAddress(
    params.prizeMint,
    params.creatorWallet,
    false,
    params.prizeTokenProgramId,
  );
  const creatorAtaInfo = await connection.getAccountInfo(creatorAta, {
    commitment: "confirmed",
  });
  if (!creatorAtaInfo) {
    throw new Error("creator_ata_not_found");
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("finalized");

  const tx = new Transaction({
    feePayer: params.creatorWallet,
    recentBlockhash: blockhash,
  });

  tx.add(
    SystemProgram.createAccount({
      fromPubkey: params.creatorWallet,
      newAccountPubkey: params.prizeVault,
      lamports: prizeRent,
      space: prizeAccountSpace,
      programId: params.prizeTokenProgramId,
    }),
    createInitializeAccountInstruction(
      params.prizeVault,
      params.prizeMint,
      params.custodyWallet,
      params.prizeTokenProgramId,
    ),
    SystemProgram.createAccount({
      fromPubkey: params.creatorWallet,
      newAccountPubkey: params.usdcVault,
      lamports: usdcRent,
      space: usdcAccountSpace,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      params.usdcVault,
      params.usdcMint,
      params.custodyWallet,
      TOKEN_PROGRAM_ID,
    ),
    createTransferInstruction(
      creatorAta,
      params.prizeVault,
      params.creatorWallet,
      params.prizeAmount,
      [],
      params.prizeTokenProgramId,
    ),
  );

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    txBase64: serialized.toString("base64"),
    blockhash,
    lastValidBlockHeight,
  };
}
