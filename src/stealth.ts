import { secp256k1 } from '@noble/curves/secp256k1'
import {
  type Address,
  bytesToHex,
  concat,
  type Hex,
  hexToBytes,
  keccak256,
  size,
  stringToBytes,
} from 'viem'
import { generatePrivateKey, publicKeyToAddress } from 'viem/accounts'

/**
 * Stealth addresses, ERC-5564 scheme 1 (secp256k1 with view tags).
 *
 * A receiver publishes a stealth meta-address: two public keys, one for spending and one for
 * viewing. A sender derives a fresh one-time address from it for every payment, using a new
 * ephemeral key, and pays there. Nobody watching the chain can tell whose address it is, or add a
 * receiver's payments up. The receiver finds its payments with its viewing key and moves them with
 * keys derived from its spending key. A viewing key alone (an accountant's view) finds every
 * payment and can move none of it.
 */

export const STEALTH_SCHEME_ID = 1n

const N = secp256k1.CURVE.n
const Point = secp256k1.ProjectivePoint
const META_PREFIX = 'st:eth:0x'
const VIEW_PREFIXES = ['stealth-view:0x', 'kova-view:0x']

export interface StealthKeys {
  spendingPrivateKey: Hex
  viewingPrivateKey: Hex
}

export interface StealthAnnouncement {
  /** The one-time address the payment goes to. */
  stealthAddress: Address
  /** The ephemeral public key, compressed (33 bytes). Published so the receiver can find it. */
  ephemeralPublicKey: Hex
  /** The first byte of the hashed shared secret: lets a scanner skip 255 of 256 others cheaply. */
  viewTag: Hex
}

/**
 * The domain-separation labels keys are derived under. The defaults are Kova's, so keys made with
 * this library open payments sent by Kova and the other way round. An app of its own can pick its
 * own labels, and must then never change them: different labels mean different keys.
 */
export interface KeyLabels {
  spending: string
  viewing: string
}

export const KOVA_LABELS: KeyLabels = {
  spending: 'kova:stealth:spending',
  viewing: 'kova:stealth:viewing',
}

/**
 * What a wallet signs to make its stealth keys. Put what the keys are for in it (an app, a shop, a
 * wallet), so one wallet can hold several separate sets. Any wallet that signs deterministically
 * (RFC 6979, which every EVM wallet does) makes the same keys from the same message every time, on
 * every device, with nothing stored.
 */
export function stealthKeysMessage(app: string, scope: string): string {
  return `${app} private receiving\n${scope}\n\nSign to open your private receiving keys. This only reads keys; it moves no money.`
}

/** A scalar from 32 bytes of hash: reduced mod n, never zero. */
function scalar(bytes: Hex): bigint {
  const k = BigInt(keccak256(bytes)) % N
  if (k === 0n) throw new Error('degenerate key')
  return k
}

const toKey = (k: bigint): Hex => `0x${k.toString(16).padStart(64, '0')}`

/** The compressed public key of a private key. */
export const compressedPublicKey = (privateKey: Hex): Hex =>
  bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))

/**
 * The stealth keys behind a 65-byte wallet signature: the spending key from its r, the viewing key
 * from its s, each hashed under its own label.
 */
export function stealthKeysFromSignature(signature: Hex, labels: KeyLabels = KOVA_LABELS): StealthKeys {
  const sig = hexToBytes(signature)
  if (sig.length !== 65) throw new Error('Expected a 65-byte signature')
  const r = bytesToHex(sig.slice(0, 32))
  const s = bytesToHex(sig.slice(32, 64))
  return {
    spendingPrivateKey: toKey(scalar(concat([r, bytesToHex(stringToBytes(labels.spending))]))),
    viewingPrivateKey: toKey(scalar(concat([s, bytesToHex(stringToBytes(labels.viewing))]))),
  }
}

/** `st:eth:0x<spending public key><viewing public key>`, both compressed, as ERC-5564 writes it. */
export function stealthMetaAddress(keys: StealthKeys): string {
  return `${META_PREFIX}${compressedPublicKey(keys.spendingPrivateKey).slice(2)}${compressedPublicKey(keys.viewingPrivateKey).slice(2)}`
}

/** The two public keys in a meta-address, checked to be points on the curve. */
export function parseStealthMetaAddress(meta: string): {
  spendingPublicKey: Hex
  viewingPublicKey: Hex
} {
  if (!meta.startsWith(META_PREFIX) || meta.length !== META_PREFIX.length + 132)
    throw new Error('Not a stealth meta-address')
  const spendingPublicKey = `0x${meta.slice(META_PREFIX.length, META_PREFIX.length + 66)}` as Hex
  const viewingPublicKey = `0x${meta.slice(META_PREFIX.length + 66)}` as Hex
  Point.fromHex(spendingPublicKey.slice(2))
  Point.fromHex(viewingPublicKey.slice(2))
  return { spendingPublicKey, viewingPublicKey }
}

/** A meta-address as the 66 raw bytes ERC-6538's registry stores. */
export function metaAddressToBytes(meta: string): Hex {
  const { spendingPublicKey, viewingPublicKey } = parseStealthMetaAddress(meta)
  return concat([spendingPublicKey, viewingPublicKey])
}

/** A meta-address from the registry's 66 raw bytes. */
export function metaAddressFromBytes(bytes: Hex): string {
  if (size(bytes) !== 66) throw new Error('A stealth meta-address is 66 bytes')
  return `${META_PREFIX}${bytes.slice(2).toLowerCase()}`
}

/** keccak256 of the compressed shared point, as ERC-5564 scheme 1 hashes it. */
function hashedSecret(privateKey: Hex, publicKey: Hex): Hex {
  return keccak256(
    bytesToHex(secp256k1.getSharedSecret(hexToBytes(privateKey), hexToBytes(publicKey), true)),
  )
}

const addressOf = (point: InstanceType<typeof Point>): Address =>
  publicKeyToAddress(bytesToHex(point.toRawBytes(false)))

/** A fresh one-time address for a meta-address, and what its owner needs to find it. */
export function generateStealthAddress(
  meta: string,
  ephemeralPrivateKey: Hex = generatePrivateKey(),
): StealthAnnouncement {
  const { spendingPublicKey, viewingPublicKey } = parseStealthMetaAddress(meta)
  const secret = hashedSecret(ephemeralPrivateKey, viewingPublicKey)
  const stealth = Point.fromHex(spendingPublicKey.slice(2)).add(Point.BASE.multiply(BigInt(secret) % N))
  return {
    stealthAddress: addressOf(stealth),
    ephemeralPublicKey: compressedPublicKey(ephemeralPrivateKey),
    viewTag: `0x${secret.slice(2, 4)}`,
  }
}

/** What scanning needs: the viewing private key and the spending public key. It can't spend. */
export interface ViewKey {
  viewingPrivateKey: Hex
  spendingPublicKey: Hex
}

/** The view part of a full set of keys. */
export const viewKeyOf = (keys: StealthKeys): ViewKey => ({
  viewingPrivateKey: keys.viewingPrivateKey,
  spendingPublicKey: compressedPublicKey(keys.spendingPrivateKey),
})

/**
 * Whether an announcement is for this view key: the one-time address it opens, or null. Checks
 * the one-byte view tag first, so 255 of every 256 other payments cost one hash.
 */
export function checkStealthAddress(
  view: ViewKey,
  announcement: Pick<StealthAnnouncement, 'ephemeralPublicKey' | 'viewTag'> & { stealthAddress?: Address },
): Address | null {
  const secret = hashedSecret(view.viewingPrivateKey, announcement.ephemeralPublicKey)
  if (`0x${secret.slice(2, 4)}` !== announcement.viewTag.toLowerCase()) return null
  const address = addressOf(
    Point.fromHex(view.spendingPublicKey.slice(2)).add(Point.BASE.multiply(BigInt(secret) % N)),
  )
  if (announcement.stealthAddress && address.toLowerCase() !== announcement.stealthAddress.toLowerCase())
    return null
  return address
}

/** The private key of a one-time address: the spending key plus the hashed shared secret, mod n. */
export function stealthPrivateKey(keys: StealthKeys, ephemeralPublicKey: Hex): Hex {
  const secret = hashedSecret(keys.viewingPrivateKey, ephemeralPublicKey)
  return toKey((BigInt(keys.spendingPrivateKey) + (BigInt(secret) % N)) % N)
}

/** A shareable view key (for an accountant): the viewing private key and the spending public key. */
export function stealthViewKey(keys: StealthKeys): string {
  return `${VIEW_PREFIXES[0]}${keys.viewingPrivateKey.slice(2)}${compressedPublicKey(keys.spendingPrivateKey).slice(2)}`
}

export function parseStealthViewKey(view: string): ViewKey {
  const prefix = VIEW_PREFIXES.find((p) => view.startsWith(p))
  if (!prefix || view.length !== prefix.length + 64 + 66) throw new Error('Not a stealth view key')
  const viewingPrivateKey = `0x${view.slice(prefix.length, prefix.length + 64)}` as Hex
  const spendingPublicKey = `0x${view.slice(prefix.length + 64)}` as Hex
  Point.fromHex(spendingPublicKey.slice(2))
  return { viewingPrivateKey, spendingPublicKey }
}

/** The shared secret behind an announcement, from either side (used to seal and open memos). */
export function sharedSecret(privateKey: Hex, publicKey: Hex): Uint8Array {
  return secp256k1.getSharedSecret(hexToBytes(privateKey), hexToBytes(publicKey), true)
}
