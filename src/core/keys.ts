import { type Bytes, concat, fromHex, toHex } from './bytes.js'
import type { ChainAdapter } from './types.js'

/**
 * Stealth keys: a spending key that moves money and a viewing key that only finds and reads it.
 *
 * They come from secret material the user already controls, never from new storage:
 *   - a wallet signature over a fixed message (fromSignature): EVM wallets sign deterministically
 *     (RFC 6979), so the same wallet and message give the same keys on every device;
 *   - or any 32+ bytes of secret (fromSeed): a passkey's PRF output, a seed phrase, a KMS secret.
 * Each key is the scheme's hash of its material under its own label.
 */
export interface StealthKeys {
  spendingPrivateKey: Bytes
  viewingPrivateKey: Bytes
}

export interface KeyLabels {
  spending: string
  viewing: string
}

/** Kova's labels: keys made under them are the keys Kova makes, so the two interoperate. */
export const KOVA_LABELS: KeyLabels = { spending: 'kova:stealth:spending', viewing: 'kova:stealth:viewing' }

/** Secret material for each key. */
export interface KeyMaterial {
  spending: Bytes
  viewing: Bytes
}

/** From a 65-byte (r ‖ s ‖ v) signature: the spending key from r, the viewing key from s. */
export function fromSignature(signature: Bytes): KeyMaterial {
  if (signature.length !== 65) throw new Error('Expected a 65-byte signature')
  return { spending: signature.slice(0, 32), viewing: signature.slice(32, 64) }
}

/** From a seed of 32 bytes or more: both keys from the same seed, told apart by their labels. */
export function fromSeed(seed: Bytes): KeyMaterial {
  if (seed.length < 32) throw new Error('A seed is at least 32 bytes')
  return { spending: seed, viewing: seed }
}

/** What a wallet signs to make its stealth keys. Name the app and what the keys are for. */
export function keysMessage(app: string, scope: string): string {
  return `${app} private receiving\n${scope}\n\nSign to open your private receiving keys. This only reads keys; it moves no money.`
}

export function deriveKeys(chain: ChainAdapter, material: KeyMaterial, labels: KeyLabels = KOVA_LABELS): StealthKeys {
  return {
    spendingPrivateKey: chain.scheme.privateKeyFrom(material.spending, labels.spending),
    viewingPrivateKey: chain.scheme.privateKeyFrom(material.viewing, labels.viewing),
  }
}

// --- Meta-addresses: st:<chain>:0x<spending public key><viewing public key> -----------------------

export interface MetaAddress {
  spendingPublicKey: Bytes
  viewingPublicKey: Bytes
}

/** The meta-address to share: both public keys, under the chain's tag (ERC-5564's format on EVM). */
export function metaAddress(chain: ChainAdapter, keys: StealthKeys): string {
  return encodeMetaAddress(chain, {
    spendingPublicKey: chain.scheme.publicKey(keys.spendingPrivateKey),
    viewingPublicKey: chain.scheme.publicKey(keys.viewingPrivateKey),
  })
}

export function encodeMetaAddress(chain: ChainAdapter, meta: MetaAddress): string {
  return `st:${chain.tag}:0x${toHex(concat(meta.spendingPublicKey, meta.viewingPublicKey))}`
}

/** Both public keys of a meta-address, checked to be valid points for the chain's scheme. */
export function parseMetaAddress(chain: ChainAdapter, meta: string): MetaAddress {
  const prefix = `st:${chain.tag}:0x`
  const length = chain.scheme.publicKeyLength
  if (!meta.startsWith(prefix) || meta.length !== prefix.length + length * 4)
    throw new Error(`Not a ${chain.tag} stealth meta-address`)
  const bytes = fromHex(meta.slice(prefix.length))
  const spendingPublicKey = bytes.slice(0, length)
  const viewingPublicKey = bytes.slice(length)
  chain.scheme.assertPublicKey(spendingPublicKey)
  chain.scheme.assertPublicKey(viewingPublicKey)
  return { spendingPublicKey, viewingPublicKey }
}

// --- View keys: find and read every payment, move none ----------------------------------------

export interface ViewKey {
  viewingPrivateKey: Bytes
  spendingPublicKey: Bytes
}

export const viewKeyOf = (chain: ChainAdapter, keys: StealthKeys): ViewKey => ({
  viewingPrivateKey: keys.viewingPrivateKey,
  spendingPublicKey: chain.scheme.publicKey(keys.spendingPrivateKey),
})

/** A shareable view key, for an accountant or an auditor. It holds no spending secret. */
export function encodeViewKey(chain: ChainAdapter, view: ViewKey): string {
  return `stealth-view:${chain.tag}:0x${toHex(concat(view.viewingPrivateKey, view.spendingPublicKey))}`
}

export function parseViewKey(chain: ChainAdapter, text: string): ViewKey {
  const prefix = `stealth-view:${chain.tag}:0x`
  const length = chain.scheme.publicKeyLength
  if (!text.startsWith(prefix) || text.length !== prefix.length + (32 + length) * 2)
    throw new Error(`Not a ${chain.tag} view key`)
  const bytes = fromHex(text.slice(prefix.length))
  const view = { viewingPrivateKey: bytes.slice(0, 32), spendingPublicKey: bytes.slice(32) }
  chain.scheme.assertPublicKey(view.spendingPublicKey)
  return view
}

/** What a wallet signs to publish its meta-address in a signed (off-chain) registry. */
export function registrationMessage(app: string, owner: string, meta: string): string {
  return `${app} private receiving\nWallet ${owner.toLowerCase()}\nKey ${meta}`
}

