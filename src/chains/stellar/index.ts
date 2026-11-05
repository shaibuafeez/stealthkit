import { sha256 } from '@noble/hashes/sha2'
import { base32 } from '@scure/base'
import { type Bytes, concat, equal, utf8 } from '../../core/bytes.js'
import type { ChainAdapter } from '../../core/types.js'
import { ed25519Scheme, signWithScalar } from '../../schemes/ed25519.js'

/** StrKey's version byte for an ed25519 account id (G…): 6 << 3. */
const ACCOUNT_ID = 6 << 3
/** ENVELOPE_TYPE_TX in Stellar's XDR. */
const ENVELOPE_TYPE_TX = new Uint8Array([0, 0, 0, 2])

/** CRC16-XModem, as StrKey checksums it (polynomial 0x1021, initial 0), little-endian. */
function crc16(bytes: Bytes): Bytes {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return new Uint8Array([crc & 0xff, crc >> 8])
}

/**
 * Stellar: an account id is the ed25519 public key in StrKey (G…, base32 with a CRC16 checksum).
 *
 * A one-time address on Stellar is not an account until someone creates it, and it can't hold an
 * asset like USDC until it adds a trustline, which only it can sign. So a sender pays with a
 * claimable balance (CAP-23) whose claimant is the one-time address: no account or trustline needed
 * to receive. The receiver claims later in one transaction it signs, while a relayer sponsors the
 * account's reserves (CAP-33) and pays the fee with a fee-bump transaction (CAP-15), so the receiver
 * never holds XLM. signStellarTransaction makes the one-time address's signature for that.
 */
export const stellar: ChainAdapter = {
  tag: 'stellar',
  scheme: ed25519Scheme,
  address(publicKey) {
    const payload = concat(new Uint8Array([ACCOUNT_ID]), publicKey)
    return base32.encode(concat(payload, crc16(payload))).replace(/=+$/, '')
  },
  addressBytes(address) {
    const raw = base32.decode(address.padEnd(Math.ceil(address.length / 8) * 8, '='))
    const payload = raw.slice(0, -2)
    if (raw.length !== 35 || payload[0] !== ACCOUNT_ID || !equal(crc16(payload), raw.slice(-2)))
      throw new Error('Not a Stellar account id (G…)')
    return payload.slice(1)
  },
}

/** The hash a Stellar signature covers: SHA-256(SHA-256(network passphrase) ‖ ENVELOPE_TYPE_TX ‖ tx XDR). */
export const stellarTransactionHash = (networkPassphrase: string, transactionXdr: Bytes): Bytes =>
  sha256(concat(sha256(utf8(networkPassphrase)), ENVELOPE_TYPE_TX, transactionXdr))

export const STELLAR_PUBLIC_NETWORK = 'Public Global Stellar Network ; September 2015'
export const STELLAR_TEST_NETWORK = 'Test SDF Network ; September 2015'

/**
 * The one-time address's signature on a Stellar transaction, as a decorated signature: the hint
 * (the public key's last four bytes) and the 64-byte ed25519 signature.
 */
export function signStellarTransaction(
  stealthPrivateKey: Bytes,
  networkPassphrase: string,
  transactionXdr: Bytes,
): { hint: Bytes; signature: Bytes } {
  const publicKey = ed25519Scheme.publicKey(stealthPrivateKey)
  return {
    hint: publicKey.slice(-4),
    signature: signWithScalar(stellarTransactionHash(networkPassphrase, transactionXdr), stealthPrivateKey),
  }
}
