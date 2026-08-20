# Pre-Req Vault Program

An Anchor program built for the Turbin3 `q3_26` prerequisite challenge. It implements a simple SOL vault, and extends the `withdraw` instruction with a cross-program invocation (CPI) into an external registration program to record proof of completion.

**Program ID:** `DmKawJ8SSzcLUxzoH2LEoM53NjWUdbyzFz2C9RdvayC5`
**Cluster:** Devnet

## Overview

The program lets a user create a personal vault, deposit SOL into it, withdraw from it, and close it. The interesting part isn't the vault mechanics themselves — those are a standard Anchor PDA pattern — it's what happens *inside* `withdraw`: after transferring SOL back to the user, the instruction calls out to a separate, externally-deployed registration program via CPI, passing along a GitHub username. That CPI is the actual deliverable this program was built to demonstrate: proving the program can call another program, sign for a PDA it controls, and pass data across the program boundary in a single atomic transaction.

## Accounts

### `user` — Signer
The wallet driving every instruction. Signs each transaction, pays the rent for account creation, and is the destination for withdrawals.

### `vault_state` — PDA
Seeds: `[b"state", user.key()]`

Stores the two bump seeds the program needs to re-derive its PDAs on later instructions:

| Field | Type | Purpose |
|---|---|---|
| `vault_bump` | `u8` | Bump for the `vault` PDA |
| `state_bump` | `u8` | Bump for `vault_state` itself |

Space: `8` (discriminator) `+ 1 + 1 = 10` bytes. It holds no balance or business data — its only job is remembering the bumps so `vault` can sign CPIs later.

### `vault` — PDA (SystemAccount)
Seeds: `[b"vault", vault_state.key()]`

Owned by the System Program. It's a plain SOL-holding account with no custom data — deposits increase its lamport balance, withdrawals decrease it. Because it's a PDA, it has no private key; the vault program signs on its behalf using `vault_state.vault_bump` as the signer seed.

### `application_account` — PDA (external, owned by the registration program)
Seeds: `[b"prereqs", user.key()]`, derived under the registration program's own address (`TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM`)

This account doesn't belong to this program — it's created and owned by the registration program. This program never reads or writes it directly; it only supplies the account as part of the CPI, and the registration program's own `initialize` instruction handles creation and writes.

| Field | Type | Purpose |
|---|---|---|
| `user` | `Pubkey` | The registering wallet |
| `bump` | `u8` | PDA bump |
| `github` | `String` | GitHub username, set by this program's CPI |
| `pre_req_ts` | `bool` | Tracks a separate TypeScript submission (unrelated to this program) |
| `pre_req_rs` | `bool` | Tracks a separate Rust submission (unrelated to this program) |

## Instructions

### 1. `initialize`
No arguments.

Creates `vault_state` and stores both bump seeds (`vault_bump`, `state_bump`). The `vault` PDA is derived at this point but not written to — it doesn't hold any SOL yet, since nothing has been deposited.

### 2. `deposit`
**Args:** `amount: u64`

Transfers `amount` lamports from `user` to `vault` via a standard System Program CPI. `user` is a real keypair signer here, so no PDA signing is needed — it's an ordinary transfer.

### 3. `withdraw`
**Args:** `amount: u64`

This instruction does two distinct things, in order:

**Step one — transfer SOL back to the user.** `vault` sends `amount` lamports to `user`. Since `vault` is a PDA with no private key, the *program* signs on its behalf, using `vault_state`'s stored `vault_bump` combined with the `b"vault"` seed. This is the standard "program signs for its own PDA" pattern.

**Step two — CPI into the registration program.** Once the transfer succeeds, the instruction calls the registration program's `initialize` instruction, passing:
- `user` (the same signer, `application_account` is derived from their key)
- `application_account` (the PDA the registration program will create)
- `system_program`
- a `github: String` argument — the submitter's GitHub username

The registration program takes it from there: it creates `application_account` and writes the `github` field. Because the CPI is issued from *this* program's `withdraw` handler rather than called directly by the client, the registration program can verify the request came from a real, deployed instance of the vault program — not just any wallet calling it directly. This is the mechanism the challenge is actually testing: proving you can wire a CPI correctly, not just move SOL around.

The registration program enforces one registration per wallet — a second `withdraw` call from the same `user` after a successful registration will fail on the CPI step, since `application_account` will already exist.

### 4. `close`
No arguments.

Sends whatever SOL remains in `vault` to `user`, and closes `vault_state`, returning its rent to `user`. This is the standard Anchor `close` pattern — no CPI to the registration program happens here; registration is a one-time side effect of `withdraw`.

## State changes over time

A typical lifecycle for one user:

1. **`initialize`** — `vault_state` account is created on-chain. `vault` exists as a derivable address but holds 0 SOL (rent-exempt minimum aside).
2. **`deposit`** — `vault`'s lamport balance increases by the deposited amount. `vault_state` is untouched.
3. **`withdraw`** — `vault`'s balance decreases by the withdrawn amount, `user`'s balance increases correspondingly, and — the first time this succeeds — `application_account` is created on the *registration* program with `github` populated.
4. **`close`** — `vault` is drained to zero and effectively abandoned (still exists as a valid PDA, just empty); `vault_state` is closed and its rent returned to `user`.

## Overall flow

```
User
  │
  ├─ initialize ──────────► creates vault_state (stores bumps)
  │
  ├─ deposit(amount) ─────► user → vault  (System Program CPI)
  │
  ├─ withdraw(amount) ────► vault → user  (vault signs via PDA seeds)
  │         │
  │         └──── CPI ────► Registration Program.initialize(github)
  │                              │
  │                              └─► creates application_account
  │                                    { user, github, bump, ... }
  │
  └─ close ───────────────► vault → user (remaining SOL)
                             vault_state closed, rent → user
```

See `docs/architecture.png` (or the diagram shared alongside this repo) for the full visual breakdown of accounts, instructions, and the CPI boundary.

## Testing

Tests are written in TypeScript (`tests/`) using Anchor's test harness, and run against a local validator cloned from devnet — since the registration program is a real, externally-deployed upgradeable program, the local validator must be started with `--clone-upgradeable-program` (or the equivalent `[[test.validator.clone]]` entries in `Anchor.toml`) to correctly replicate both the program and its program-data account.

```bash
anchor test
```

For the actual submission, the program was deployed and tested against devnet directly, since the registration program only exists there and the challenge requires a real, verifiable registration.
