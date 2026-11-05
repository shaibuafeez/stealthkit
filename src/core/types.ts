import type { Bytes } from './bytes.js'

/**
 * The four seams of the framework. Everything chain-specific sits behind one of them; the core
 * (keys, one-time addresses, view keys, sealed notes, routing) never names a chain.
 *
 *   Scheme      the curve: how keys combine (secp256k1 for EVM, ed25519 for Solana, Sui, Aptos)
 *   Chain       how a public key becomes an address, and the chain's tag in a meta-address
 *   Transport   where payments are announced and how they're read back (an event, a memo, an API)
 *   Sponsor     how a one-time address moves money without holding the chain's gas token
 *
 * A chain is supported when it has a Chain adapter; it is fully usable when it also has a
 * Transport and a Sponsor. See DESIGN.md.
 */

/** The curve-level operations of a stealth scheme. Private keys are scalars, as bytes. */
export interface StealthScheme {
  /** ERC-5564 scheme id where one exists (1: secp256k1 with view tags); else a registered id. */
  readonly id: number
  readonly name: string
  /** Length of a public key as a meta-address carries it. */
  readonly publicKeyLength: number
  /** A private key from secret material, domain-separated by a label. Deterministic. */
  privateKeyFrom(material: Bytes, label: string): Bytes
  /** A fresh random private key (for the sender's one-time ephemeral key). */
  randomPrivateKey(): Bytes
  publicKey(privateKey: Bytes): Bytes
  /** Throws unless the bytes are a valid public key in the prime-order group. */
  assertPublicKey(publicKey: Bytes): void
  /** The ECDH shared point of one side's private key and the other's public key, encoded. */
  sharedPoint(privateKey: Bytes, publicKey: Bytes): Bytes
  /** The 32-byte hashed secret both sides derive from the shared point. */
  hashedSecret(sharedPoint: Bytes): Bytes
  /** The one-time public key: spending public key + scalar(hashed)·G. */
  stealthPublicKey(spendingPublicKey: Bytes, hashedSecret: Bytes): Bytes
  /** The one-time private key: spending private key + scalar(hashed), mod the group order. */
  stealthPrivateKey(spendingPrivateKey: Bytes, hashedSecret: Bytes): Bytes
  /** A 32-byte symmetric key for sealing a note, from the shared point. */
  memoKey(sharedPoint: Bytes, label: string): Bytes
}

/** How a chain names addresses. */
export interface ChainAdapter {
  /** The tag a meta-address carries: 'eth' (ERC-5564's, for every EVM chain), 'sol', 'sui', 'aptos'. */
  readonly tag: string
  readonly scheme: StealthScheme
  /** The address a public key controls, written as the chain writes it. */
  address(publicKey: Bytes): string
  /** An address's raw bytes, which a sealed note is bound to. */
  addressBytes(address: string): Bytes
}

/** A payment as announced: enough for its receiver, and nobody else, to find and open it. */
export interface Announcement {
  schemeId: number
  stealthAddress: string
  ephemeralPublicKey: Bytes
  /** One byte of the hashed secret: lets a scanner skip 255 of 256 others cheaply. */
  viewTag: number
  /** What was paid, when the transport carries it. */
  asset?: Bytes
  amount?: bigint
  /** The sealed note, or none. */
  sealed?: Bytes | null
}

/** Where a chain's announcements are read from. */
export interface AnnouncementSource<Cursor = bigint> {
  /** Announcements between two cursors (blocks, slots, checkpoints, API pages). */
  read(from: Cursor, to: Cursor): Promise<Array<Announcement & { locator: string }>>
}

/** How a one-time address authorizes a transfer that someone else submits and pays for. */
export interface Sponsor<Transfer, Authorization> {
  authorize(stealthPrivateKey: Bytes, transfer: Transfer): Promise<Authorization>
}
