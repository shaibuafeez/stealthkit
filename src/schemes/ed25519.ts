import { ed25519 } from '@noble/curves/ed25519'
import { sha512 } from '@noble/hashes/sha2'
import { randomBytes } from '@noble/hashes/utils'
import { type Bytes, concat, littleEndian, toLittleEndian, utf8 } from '../core/bytes.js'
import type { StealthScheme } from '../core/types.js'

const L = ed25519.CURVE.n
const Point = ed25519.ExtendedPoint

/** A scalar mod L from 64 bytes of hash (a wide reduction, so it carries no bias). */
const wide = (bytes: Bytes) => {
  const k = littleEndian(bytes) % L
  if (k === 0n) throw new Error('degenerate key')
  return k
}
const scalarBytes = (k: bigint) => toLittleEndian(k, 32)
const SECRET_LABEL = utf8('stealthkit:ed25519:secret')
const NONCE_LABEL = utf8('stealthkit:ed25519:nonce')

/**
 * Stealth addresses on ed25519, for Solana, Sui and Aptos: the CryptoNote construction Monero has
 * run since 2014, with ERC-5564's view tag added.
 *
 *   shared  = enc( a·B )                                32 bytes
 *   H       = SHA-512(shared ‖ label)                   64 bytes; view tag = H[0]
 *   P       = S + (H mod L)·G                           the one-time public key (an address)
 *   p       = s + (H mod L)               mod L         its private key, a raw scalar
 *
 * Keys are raw scalars, not RFC 8032 seeds: P has no seed, only p. signWithScalar signs with p
 * directly, and its signatures verify under standard Ed25519 (RFC 8032), so a one-time address
 * signs a Solana, Sui or Aptos transaction like any other key. Public keys are checked to lie in the
 * prime-order subgroup, so a malicious meta-address can't push a sender into a small subgroup.
 */
export const ed25519Scheme: StealthScheme = {
  id: 0x0101,
  name: 'ed25519 (CryptoNote with view tags)',
  publicKeyLength: 32,
  privateKeyFrom: (material, label) => scalarBytes(wide(sha512(concat(material, utf8(label))))),
  randomPrivateKey: () => scalarBytes(wide(sha512(randomBytes(32)))),
  publicKey: (privateKey) => Point.BASE.multiply(littleEndian(privateKey)).toRawBytes(),
  assertPublicKey(publicKey) {
    if (publicKey.length !== 32) throw new Error('An ed25519 public key is 32 bytes')
    const point = Point.fromHex(publicKey)
    if (point.equals(Point.ZERO) || !point.isTorsionFree()) throw new Error('Not a point of the prime-order group')
  },
  sharedPoint(privateKey, publicKey) {
    const point = Point.fromHex(publicKey)
    if (!point.isTorsionFree()) throw new Error('Not a point of the prime-order group')
    return point.multiply(littleEndian(privateKey)).toRawBytes()
  },
  hashedSecret: (sharedPoint) => sha512(concat(sharedPoint, SECRET_LABEL)),
  stealthPublicKey: (spendingPublicKey, hashed) =>
    Point.fromHex(spendingPublicKey).add(Point.BASE.multiply(wide(hashed))).toRawBytes(),
  stealthPrivateKey: (spendingPrivateKey, hashed) =>
    scalarBytes((littleEndian(spendingPrivateKey) + wide(hashed)) % L),
  memoKey: (sharedPoint, label) => sha512(concat(sharedPoint, utf8(label))).slice(0, 32),
}

/**
 * An Ed25519 signature made with a raw scalar (a one-time private key) instead of an RFC 8032
 * seed. The nonce is derived deterministically from the scalar and the message, as RFC 8032
 * derives it from the seed, so signing twice gives the same signature and no randomness can leak
 * the key. Verifies with any standard Ed25519 verifier.
 */
export function signWithScalar(message: Bytes, privateKey: Bytes): Bytes {
  const a = littleEndian(privateKey) % L
  const A = Point.BASE.multiply(a).toRawBytes()
  const prefix = sha512(concat(NONCE_LABEL, privateKey)).slice(32)
  const r = littleEndian(sha512(concat(prefix, message))) % L
  const R = Point.BASE.multiply(r).toRawBytes()
  const k = littleEndian(sha512(concat(R, A, message))) % L
  return concat(R, scalarBytes((r + k * a) % L))
}

/** Standard Ed25519 verification (RFC 8032). */
export const verifyEd25519 = (signature: Bytes, message: Bytes, publicKey: Bytes): boolean =>
  ed25519.verify(signature, message, publicKey)
