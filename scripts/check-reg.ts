import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";

// ---- CONFIG ----
const REGISTRATION_PROGRAM_ID = new PublicKey(
  "TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM"
);
const RPC_URL = "https://api.devnet.solana.com";
//const IDL_PATH = "./idls/registration.json";

const IDL_PATH = path.join(__dirname, "../idls/registration.json");

async function main() {
  // Load your local wallet keypair (same one used by anchor test)
  const walletKeypairPath =
    process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = Uint8Array.from(
    JSON.parse(fs.readFileSync(walletKeypairPath, "utf-8"))
  );
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(secretKey);
  const wallet = new anchor.Wallet(walletKeypair);

  console.log("Wallet:", wallet.publicKey.toBase58());

  // Set up connection + provider
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Derive the application_account PDA: seeds = ["prereqs", user_pubkey]
  const [applicationAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("prereqs"), wallet.publicKey.toBuffer()],
    REGISTRATION_PROGRAM_ID
  );

  console.log("Application account PDA:", applicationAccountPda.toBase58());

  // Load the registration IDL and build a Program client
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const program = new anchor.Program(idl, provider);

  // Fetch and decode the account
  const appAccount = await (program.account as any).applicationAccount.fetch(
    applicationAccountPda
  );

  console.log("\n--- Decoded ApplicationAccount ---");
  console.log("User:      ", appAccount.user.toBase58());
  console.log("Bump:      ", appAccount.bump);
  console.log("GitHub:    ", appAccount.github);
  console.log("pre_req_ts:", appAccount.preReqTs);
  console.log("pre_req_rs:", appAccount.preReqRs);
}

main().catch((err) => {
  console.error("Error fetching registration account:", err);
  process.exit(1);
});
