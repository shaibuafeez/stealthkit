import { blake2b } from '@noble/hashes/blake2b'
import { base64 } from '@scure/base'
import { type Bytes, concat, fromHex, toHex } from '../../core/bytes.js'
import type { ChainAdapter } from '../../core/types.js'
import { ed25519Scheme, signWithScalar } from '../../schemes/ed25519.js'

const ED25519_FLAG = 0x00

/**
 * Sui: an address is BLAKE2b-256(flag ‖ public key), with 0x00 for ed25519.
 *
 * Spending without SUI is native: a sponsored transaction has a gas owner (the relayer) and a
 * sender (the one-time address), and both sign. signSuiTransaction makes the sender's half.
 */
export const sui: ChainAdapter = {
  tag: 'sui',
  scheme: ed25519Scheme,
  address: (publicKey) => `0x${toHex(blake2b(concat(new Uint8Array([ED25519_FLAG]), publicKey), { dkLen: 32 }))}`,
  addressBytes(address) {
    const bytes = fromHex(address)
    if (bytes.length !== 32) throw new Error('A Sui address is 32 bytes')
    return bytes
  },
}

/** The digest a Sui signature covers: BLAKE2b-256 of the transaction intent (0,0,0) and its BCS bytes. */
export const suiTransactionDigest = (transactionBytes: Bytes): Bytes =>
  blake2b(concat(new Uint8Array([0, 0, 0]), transactionBytes), { dkLen: 32 })

/** The one-time address's signature on a Sui transaction, serialized as Sui expects (flag ‖ sig ‖ key, base64). */
export function signSuiTransaction(stealthPrivateKey: Bytes, transactionBytes: Bytes): string {
  const signature = signWithScalar(suiTransactionDigest(transactionBytes), stealthPrivateKey)
  return base64.encode(concat(new Uint8Array([ED25519_FLAG]), signature, ed25519Scheme.publicKey(stealthPrivateKey)))
}
