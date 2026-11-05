import { sha3_256 } from '@noble/hashes/sha3'
import { type Bytes, concat, fromHex, toHex, utf8 } from '../../core/bytes.js'
import type { ChainAdapter } from '../../core/types.js'
import { ed25519Scheme, signWithScalar } from '../../schemes/ed25519.js'

const ED25519_SCHEME = 0x00

/**
 * Aptos: an account address is its authentication key, SHA3-256(public key ‖ 0x00) for ed25519.
 *
 * Spending without APT is native: a fee-payer transaction names a fee payer (the relayer), and
 * the one-time address signs the same transaction with its data (RawTransactionWithData).
 */
export const aptos: ChainAdapter = {
  tag: 'aptos',
  scheme: ed25519Scheme,
  address: (publicKey) => `0x${toHex(sha3_256(concat(publicKey, new Uint8Array([ED25519_SCHEME]))))}`,
  addressBytes(address) {
    const bytes = fromHex(address)
    if (bytes.length !== 32) throw new Error('An Aptos address is 32 bytes')
    return bytes
  },
}

/**
 * What an Aptos signature covers: SHA3-256 of the domain ("APTOS::RawTransaction", or
 * "APTOS::RawTransactionWithData" for fee-payer and multi-agent transactions) and the BCS bytes.
 */
export function aptosSigningMessage(bcsBytes: Bytes, withData = true): Bytes {
  return concat(sha3_256(utf8(withData ? 'APTOS::RawTransactionWithData' : 'APTOS::RawTransaction')), bcsBytes)
}

/** The one-time address's ed25519 signature on an Aptos transaction. */
export const signAptosTransaction = (stealthPrivateKey: Bytes, bcsBytes: Bytes, withData = true): Bytes =>
  signWithScalar(aptosSigningMessage(bcsBytes, withData), stealthPrivateKey)
