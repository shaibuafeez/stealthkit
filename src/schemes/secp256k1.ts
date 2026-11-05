import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bigEndian, type Bytes, concat, toBigEndian, utf8 } from '../core/bytes.js'
import type { StealthScheme } from '../core/types.js'

const N = secp256k1.CURVE.n
const Point = secp256k1.ProjectivePoint

const nonZero = (k: bigint) => {
  if (k === 0n) throw new Error('degenerate key')
  return k
}

/**
 * ERC-5564 scheme 1: secp256k1 with view tags, as every EVM chain uses it.
 *
 *   shared  = compressed( ECDH(a, B) )                 33 bytes
 *   hashed  = keccak256(shared)                        32 bytes; view tag = hashed[0]
 *   P       = S + (hashed mod n)·G                     the one-time public key
 *   p       = s + (hashed mod n)          mod n        its private key
 *
 * Keys from material: keccak256(material ‖ label) mod n. Memo keys: keccak256(shared ‖ label).
 * Byte-for-byte what Kova runs on Monad, so the two interoperate.
 */
export const secp256k1Scheme: StealthScheme = {
  id: 1,
  name: 'secp256k1 (ERC-5564 scheme 1)',
  publicKeyLength: 33,
  privateKeyFrom: (material, label) => toBigEndian(nonZero(bigEndian(keccak_256(concat(material, utf8(label)))) % N), 32),
  randomPrivateKey: () => secp256k1.utils.randomPrivateKey(),
  publicKey: (privateKey) => secp256k1.getPublicKey(privateKey, true),
  assertPublicKey(publicKey) {
    if (publicKey.length !== 33) throw new Error('A secp256k1 public key is 33 bytes, compressed')
    Point.fromHex(publicKey).assertValidity()
  },
  sharedPoint: (privateKey, publicKey) => secp256k1.getSharedSecret(privateKey, publicKey, true),
  hashedSecret: (sharedPoint) => keccak_256(sharedPoint),
  stealthPublicKey: (spendingPublicKey: Bytes, hashed: Bytes) =>
    Point.fromHex(spendingPublicKey)
      .add(Point.BASE.multiply(nonZero(bigEndian(hashed) % N)))
      .toRawBytes(true),
  stealthPrivateKey: (spendingPrivateKey, hashed) =>
    toBigEndian(nonZero((bigEndian(spendingPrivateKey) + (bigEndian(hashed) % N)) % N), 32),
  memoKey: (sharedPoint, label) => keccak_256(concat(sharedPoint, utf8(label))),
}

/** The uncompressed form (65 bytes) of a compressed secp256k1 public key. */
export const uncompressed = (publicKey: Bytes): Bytes => Point.fromHex(publicKey).toRawBytes(false)
