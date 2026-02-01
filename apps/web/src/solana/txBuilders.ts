import type { Connection, PublicKey } from "@solana/web3.js";
import {
  PublicKey as Web3PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createInitializeAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

import { getSolanaConnection } from "./connection";
import { getTokenProgramIdForMint } from "./mint";
import { getTokenAccountSpaceForMint } from "./tokenAccount";

export type PrizeDepositTxResult = {
  txBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

export type OrderPaymentTxResult = PrizeDepositTxResult;

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
  const prizeRent = await connection.getMinimumBalanceForRentExemption(prizeAccountSpace);

  const usdcAccountSpace = 165;
  const usdcRent = await connection.getMinimumBalanceForRentExemption(usdcAccountSpace);

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

export async function buildOrderPaymentTx(params: {
  connection?: Connection;
  buyerWallet: PublicKey;
  usdcMint: PublicKey;
  usdcVault: PublicKey;
  amount: bigint;
  memo: string;
}): Promise<OrderPaymentTxResult> {
  const connection = params.connection ?? getSolanaConnection();
  if (params.amount <= 0n) {
    throw new Error("invalid_amount");
  }

  const tokenProgramId = await getTokenProgramIdForMint(connection, params.usdcMint);
  const buyerAta = await getAssociatedTokenAddress(
    params.usdcMint,
    params.buyerWallet,
    false,
    tokenProgramId,
  );
  const buyerAtaInfo = await connection.getAccountInfo(buyerAta, {
    commitment: "confirmed",
  });
  if (!buyerAtaInfo) {
    throw new Error("buyer_ata_not_found");
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("finalized");

  const tx = new Transaction({
    feePayer: params.buyerWallet,
    recentBlockhash: blockhash,
  });

  tx.add(
    createTransferInstruction(
      buyerAta,
      params.usdcVault,
      params.buyerWallet,
      params.amount,
      [],
      tokenProgramId,
    ),
    createMemoInstruction(params.memo, params.buyerWallet),
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

const MEMO_PROGRAM_ID = new Web3PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function createMemoInstruction(memo: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(memo, "utf8"),
  });
}
