# stealthkit: design

**Status:** v1, implemented. **Scope:** private receiving and spending of fungible assets on any
chain whose accounts are secp256k1 or ed25519 keys. **Reference implementation:** this repository.
**Production lineage:** Kova's private payments on Monad, which this is extracted from and stays
byte-compatible with.

---

## 1. Problem

On a public chain, a payment links two addresses forever. A receiver who shares one address lets
anyone list every payment it has ever had, who paid, how much and when: a shop's revenue, a
freelancer's clients, a person's salary. Fresh addresses per payment solve that only if the sender can
make one **without asking the receiver**, and the receiver can **find and spend** it without a
trusted server and without first funding it with gas, which would link it right back.

## 2. Goals and non-goals

**Goals**

1. A sender derives a fresh, unlinkable address for every payment from one public string.
2. The receiver finds its payments from public chain data alone, cheaply.
3. A view key that finds and reads everything, and can move nothing.
4. A sealed note (who paid, why) that only the receiver can read.
5. Spending from a one-time address without that address ever holding the gas token.
6. One core, every chain: adding a chain means writing an adapter, never changing the core.
7. Deterministic keys from material the user already has: nothing new to store or back up.
8. Byte-exact interoperability with ERC-5564 on EVM, and with Kova.

**Non-goals**

- Hiding amounts or the asset. Transfers stay public; this hides *who*, not *how much*.
- Mixing or pooling funds. There is no shared pool and no custody: each payment is its own address.
- A new token standard, or new contracts on chains that already have what's needed.

## 3. Architecture

```
          ┌──────────────────────────── core (chain-neutral) ────────────────────────────┐
          │  keys · meta-addresses · one-time addresses · view keys · sealed notes ·      │
          │  announcement envelope · privacy router                                       │
          └───────────────┬───────────────┬───────────────────┬───────────────────────────┘
                          │               │                   │
                     ┌────┴────┐     ┌────┴────┐        ┌─────┴──────┐        ┌──────────┐
                     │ Scheme  │     │  Chain  │        │ Transport  │        │ Sponsor  │
                     │ (curve) │     │(address)│        │(announce)  │        │(gasless) │
                     └────┬────┘     └────┬────┘        └─────┬──────┘        └────┬─────┘
          secp256k1 ──────┤               ├── evm ────────────┼── ERC-5564 event ──┼── EIP-3009
          ed25519 ────────┘               ├── solana ─────────┼── envelope (memo) ─┼── fee payer
                                          ├── sui ────────────┼── envelope (event) ┼── sponsored tx
                                          ├── aptos ──────────┼── envelope (event) ┼── fee-payer tx
                                          └── stellar ────────┴── envelope ────────┴── fee bump + claimable balance
```

The core is pure functions over bytes: no network, no chain library. Everything chain-specific sits
behind one of four seams (`src/core/types.ts`):

| Seam | Answers | Implemented by |
|---|---|---|
| **Scheme** | How keys combine on this curve | `secp256k1Scheme`, `ed25519Scheme` |
| **Chain** | How a public key becomes an address; the chain's tag | `evm`, `solana`, `sui`, `aptos`, `stellar` |
| **Transport** | Where payments are announced, and how they're read back | ERC-5564 announcer (EVM); the envelope over any byte carrier |
| **Sponsor** | How a one-time address moves money without holding gas | EIP-3009; the chain's native fee payer or sponsorship |

A chain is **supported** when it has a Chain adapter (and so a Scheme). It is **fully usable** when it
also has a Transport and a Sponsor.

## 4. Objects

| Object | What it is | Who holds it |
|---|---|---|
| Spending key | Moves money from one-time addresses | Receiver only |
| Viewing key | Finds payments, opens notes | Receiver; anyone given the view key |
| Meta-address | Both public keys: `st:<chain>:0x<spend><view>` | Public: shared or registered |
| View key | Viewing private key + spending public key: `stealth-view:<chain>:0x…` | Accountant, auditor, scanner |
| Ephemeral key | The sender's throwaway key for one payment | Sender, for one payment; only its public half is published |
| One-time address | Where one payment goes | Anyone can see it; only the receiver can tie it to themselves |
| Announcement | Address, ephemeral public key, view tag, optional asset, amount and note | Public |
| Sealed note | Encrypted `{from, name, note, kind, proof}` | Public ciphertext; receiver reads it |

## 5. Schemes

Both schemes follow the same shape:

```
sender:    e (random)  E = e·G               shared = enc(e·V)
receiver:              shared = enc(v·E)
both:      h = H(shared)    view tag = h[0]    P = S + scalar(h)·G
receiver:  p = s + scalar(h)   (mod the group order)      address = chain.address(P)
```

where `s, S` is the spending key pair and `v, V` the viewing key pair.

### 5.1 secp256k1: ERC-5564 scheme 1 (id 1)

| Step | Definition |
|---|---|
| Key from material | `keccak256(material ‖ label) mod n`, rejecting 0 |
| Public key | compressed SEC1, 33 bytes |
| Shared point | compressed `e·V`, 33 bytes |
| Hashed secret | `keccak256(shared)`; view tag = first byte |
| Scalar | `h mod n` |
| Memo key | `keccak256(shared ‖ label)` |
| EVM address | last 20 bytes of `keccak256(uncompressed P without its 0x04)` |

This is ERC-5564 scheme 1 exactly, so wallets that implement ERC-5564 find these payments, and these
keys find theirs.

### 5.2 ed25519: CryptoNote with view tags (id 0x0101)

The construction Monero has run since 2014 (CryptoNote one-time addresses), with ERC-5564's view tag.

| Step | Definition |
|---|---|
| Key from material | `SHA-512(material ‖ label)`, reduced mod ℓ (wide reduction: no bias) |
| Public key | `k·B`, RFC 8032 encoding, 32 bytes |
| Point validation | Must decode, must not be the identity, must be torsion-free (prime-order subgroup) |
| Shared point | `enc(e·V)`, 32 bytes |
| Hashed secret | `SHA-512(shared ‖ "stealthkit:ed25519:secret")`, 64 bytes; view tag = first byte |
| Scalar | wide reduction of the 64 bytes mod ℓ |
| Memo key | first 32 bytes of `SHA-512(shared ‖ label)` |

**Raw-scalar signing.** One-time private keys are scalars, not RFC 8032 seeds: no seed exists whose
hash gives `p`. `signWithScalar` signs with `p` directly:

```
r = SHA-512( SHA-512("stealthkit:ed25519:nonce" ‖ p)[32..64] ‖ M ) mod ℓ
R = r·B        k = SHA-512(R ‖ A ‖ M) mod ℓ        S = r + k·p mod ℓ        signature = R ‖ S
```

The nonce is deterministic from the key and the message, as RFC 8032 derives it from the seed, so
no randomness can leak the key. Signatures verify under any standard Ed25519 verifier, so a one-time
address signs Solana, Sui, Aptos and Stellar transactions like any other account.

**Why validate torsion.** ed25519 has cofactor 8. A malicious meta-address carrying a point with a
small-order component could make a sender's shared secret take one of a few values the attacker
can guess. Rejecting non-torsion-free points on parse closes that.

The scheme id 0x0101 is stealthkit's until an ERC-5564-style registry assigns ed25519 an id.

## 6. Wire formats

All formats are versioned; a new version is a new byte or prefix, never a reinterpretation.

**Meta-address:** `st:<chain>:0x<spending public key><viewing public key>`, lowercase hex. EVM chains
use `eth`, as ERC-5564 does, whichever EVM chain it is; others use `sol`, `sui`, `aptos`, `stellar`.

**View key:** `stealth-view:<chain>:0x<viewing private key (32)><spending public key>`. Kova's
`kova-view:0x…` form is read on EVM.

**Sealed note** (`src/core/memo.ts`):

```
0x01 ‖ nonce (24) ‖ XChaCha20-Poly1305(key = scheme.memoKey(shared, label), nonce, aad = one-time address bytes)(JSON)
```

Bound to the one-time address as associated data, so a note can't be moved to another payment. The
JSON carries only known fields, each trimmed to its limit on open; at most 441 bytes sealed.

**Envelope** (`src/core/envelope.ts`): one self-describing byte layout for any transport that
carries bytes (a Solana memo instruction, a Sui or Aptos event, Stellar's Soroban events, an
indexer's API):

```
0x01 ‖ scheme id (u16 BE) ‖ len‖address ‖ len‖ephemeral key ‖ view tag ‖ len‖asset ‖ len‖amount (BE) ‖ sealed note…
```

**ERC-5564 metadata** (EVM): `view tag ‖ selector (4) ‖ token (20) ‖ amount (32) ‖ sealed note`, the
layout ERC-5564 recommends for tokens, with the note appended.

## 7. Keys

Keys come from secret material the user already controls; stealthkit never stores a key.

| Source | Use | Note |
|---|---|---|
| `fromSignature(sig)` | A wallet signs `keysMessage(app, scope)`; spending from r, viewing from s | EVM wallets sign deterministically (RFC 6979) |
| `fromSeed(seed)` | A passkey's PRF output, a seed phrase, a KMS secret | Labels tell the two keys apart |

**Requirements**

- **Determinism.** A wallet that signs with random nonces (some MPC and hardware setups) makes new
  keys every time, and the user loses track of their payments. Sign the message twice at setup and
  refuse a wallet whose signatures differ.
- **Stable labels.** Labels are part of the key. Change one and the keys change. Kova's labels are the
  default, for interoperability; an app that wants its own keys picks its labels once, forever.
- **Scopes.** Put what the keys are for in the message (a shop id, an app) to give one wallet
  several unlinkable sets.
- **Across chains.** All ed25519 chains share one scheme. The same material and labels give the same
  public keys on Solana, Sui, Aptos and Stellar, so the meta-addresses link to each other (their
  payments never do). Put the chain in the scope to keep them apart.

## 8. Finding payments

A receiver reads every announcement and, for each:

1. computes the shared point from the ephemeral key (one point multiplication);
2. hashes it and compares the view tag (rejects 255 of 256 others here);
3. only on a match, derives the address and compares it with the announced one.

Scanning is linear in announcements and independent of a receiver's own history. On EVM,
`scanAnnouncements` reads the ERC-5564 event in block ranges; public RPCs cap the range, so
production systems index the announcer once and serve announcements to every client (an indexer
learns nothing it can't read from the chain).

## 9. Spending without gas

A one-time address holds the asset and nothing else. Funding it with gas from a known wallet links
the two, so it never is: each chain's Sponsor lets a relayer pay.

| Chain | Mechanism | The one-time address signs | The relayer |
|---|---|---|---|
| EVM | EIP-3009 `transferWithAuthorization` (AUSD, USDC) | An EIP-712 transfer authorization | Submits it and pays gas; can't change recipient or amount |
| Solana | Transaction fee payer | The transaction message | Is the fee payer; pays rent for token accounts it creates |
| Sui | Sponsored transaction | The transaction intent | Is the gas owner, co-signs |
| Aptos | Fee-payer transaction | `RawTransactionWithData` | Is the fee payer, co-signs |
| Stellar | Claimable balance + sponsored reserves + fee bump | The claim transaction | Sponsors the reserves, fee-bumps |

**Stellar specifics.** A Stellar account must exist and hold a trustline before it can hold USDC, and
only the account can sign its trustline. So a sender pays a **claimable balance** (CAP-23) whose
claimant is the one-time address: no account needed to receive. The receiver later claims in one
transaction that creates the account and trustline, with reserves sponsored (CAP-33) and the fee
paid by a fee-bump (CAP-15).

**EVM assets without EIP-3009.** Use an ERC-4337 paymaster with an account at the one-time address, or
EIP-7702 delegation where the chain supports it. Not in v1.

## 10. The privacy router

Private funds end up across many one-time addresses. `routePayment` chooses where each payment
comes from so nobody manages it by hand, in this order: one private address that covers it (the
change stays there, still private); the balance when it covers; several private addresses gathered
into one first; and, last, just enough private funds moved into the balance. Each step is less
private than the one before, so the router only falls through when it has to.

## 11. Privacy model

| Hidden from chain observers | Visible |
|---|---|
| Which one-time addresses belong to a receiver | Amounts and assets |
| A receiver's total and its payers | That a payment went to some one-time address, and when |
| Notes | A sender paying from a known wallet, as the sender |
| | Links made when a one-time address pays a known wallet |
| | Timing: receiving and spending close together can be correlated |

Relayers and indexers can point payments at a receiver but never move them: neither holds a
spending key. A relayer does learn which one-time addresses it carries transfers for, and when.

**Practice that keeps it private:** never fund a one-time address from a wallet tied to the
receiver; don't sweep everything to one known wallet right away; let the router spend from private
funds before gathering them; use several relayers when they're available.

## 12. Security

| Concern | Handling |
|---|---|
| Malicious meta-address | Every point is validated on parse; ed25519 points must be torsion-free |
| Key leakage through signing | Deterministic nonces (RFC 6979 on secp256k1; derived from key and message on ed25519) |
| Note moved to another payment | AEAD bound to the one-time address |
| Note tampering | Poly1305 tag; unknown fields dropped; lengths capped |
| Sender impersonation in a note | `stealthSender` grades the claim: chain-proven, signed or merely claimed |
| Replay of a gasless transfer | EIP-3009's one-time nonce and expiry; native replay protection elsewhere |
| Weak randomness | Ephemeral keys and note nonces from the platform CSPRNG (`@noble/hashes`) |
| Side channels | Curve arithmetic from `@noble/curves`, constant-time where it matters |

stealthkit itself is not audited yet. Its cryptography comes from `@noble/curves` and
`@noble/hashes` (both independently audited) and `@noble/ciphers`, all pure TypeScript with no
native code.

## 13. Conformance

`test/vectors/stealthkit-v1.json` is **normative**: fixed inputs and every output (keys,
meta-address, view key, one-time address, view tag, one-time private key, sealed note, envelope) for
each chain. A port to another language is conformant when it reproduces every value.
`test/vectors/kova-evm.json` comes from Kova's production code and pins EVM compatibility.

## 14. Adding a chain

1. **Scheme.** If accounts are secp256k1 or ed25519 keys, reuse one. Otherwise implement
   `StealthScheme` (and register a scheme id).
2. **Chain adapter.** `tag`, `address(publicKey)` exactly as the chain writes addresses, and
   `addressBytes(address)` that validates and returns the raw bytes.
3. **Signing helper.** The one function that signs the chain's native transaction with a one-time
   key (for ed25519 chains: the chain's signing-message rules around `signWithScalar`).
4. **Transport.** Use the chain's ERC-5564-style announcer if one exists; otherwise carry the envelope
   in a memo, an event or an indexer API, and document it.
5. **Sponsor.** Document and, where it's pure, implement how a relayer pays the fee.
6. **Vectors and tests.** Add the chain to `scripts/vectors.mjs`, and tests that: payments are
   found only by their receiver; the one-time key's address matches; its signatures verify under the
   chain's standard verifier; a known address encodes as the chain's own tools encode it.

## 15. Versioning

| Thing | Versioned by |
|---|---|
| Scheme | Scheme id (1, 0x0101) |
| Sealed note | Leading version byte (0x01) |
| Envelope | Leading version byte (0x01) |
| Meta-address and view key | Their prefixes |
| Keys | Labels and the signed message (never change them in place) |

## 16. Roadmap

- An announcer for Solana (program) and Stellar (Soroban contract), replacing memo transport.
- An EVM Sponsor for assets without EIP-3009 (ERC-4337 paymaster, EIP-7702).
- A shared indexer API spec, so wallets can switch indexers freely.
- Independent review of the ed25519 scheme and raw-scalar signing.
