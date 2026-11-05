import { bigEndian, type Bytes, concat, toBigEndian } from './bytes.js'
import type { Announcement, ChainAdapter } from './types.js'

/**
 * The announcement envelope: one byte layout for any transport that carries bytes, for chains with
 * no ERC-5564 announcer (a Solana memo instruction, a Sui or Aptos event, an indexer's API). EVM
 * chains use ERC-5564's event instead (chains/evm), which carries the same fields.
 *
 *   0       version            0x01
 *   1..2    scheme id          u16, big-endian
 *   3       n                  address length, then n bytes of the one-time address
 *   …       m                  ephemeral public key length, then m bytes
 *   …       view tag           1 byte
 *   …       k                  asset id length (0: none), then k bytes
 *   …       j                  amount length (0: none), then j bytes, big-endian
 *   …       sealed note        the rest (empty: none)
 *
 * Every length is one byte, so an envelope is self-describing and parses without knowing the chain.
 */
export const ENVELOPE_VERSION = 1

const field = (bytes: Bytes) => {
  if (bytes.length > 255) throw new Error('An envelope field is at most 255 bytes')
  return concat(new Uint8Array([bytes.length]), bytes)
}

export function encodeEnvelope(chain: ChainAdapter, a: Announcement): Bytes {
  if (a.schemeId < 0 || a.schemeId > 0xffff) throw new Error('A scheme id is 16 bits')
  const amount = a.amount === undefined ? new Uint8Array() : trimmed(toBigEndian(a.amount, 32))
  return concat(
    new Uint8Array([ENVELOPE_VERSION, a.schemeId >> 8, a.schemeId & 0xff]),
    field(chain.addressBytes(a.stealthAddress)),
    field(a.ephemeralPublicKey),
    new Uint8Array([a.viewTag]),
    field(a.asset ?? new Uint8Array()),
    field(amount),
    a.sealed ?? new Uint8Array(),
  )
}

const trimmed = (bytes: Bytes) => {
  let i = 0
  while (i < bytes.length - 1 && bytes[i] === 0) i++
  return bytes.slice(i)
}

/** An envelope's fields, or null when the bytes aren't a v1 envelope. The address stays raw bytes. */
export function decodeEnvelope(bytes: Bytes): (Omit<Announcement, 'stealthAddress'> & { stealthAddressBytes: Bytes }) | null {
  try {
    if (bytes[0] !== ENVELOPE_VERSION || bytes.length < 8) return null
    let at = 3
    const take = () => {
      const n = bytes[at] as number
      const out = bytes.slice(at + 1, at + 1 + n)
      if (out.length !== n) throw new Error('short')
      at += 1 + n
      return out
    }
    const schemeId = ((bytes[1] as number) << 8) | (bytes[2] as number)
    const stealthAddressBytes = take()
    const ephemeralPublicKey = take()
    const viewTag = bytes[at] as number
    at += 1
    const asset = take()
    const amount = take()
    const sealed = bytes.slice(at)
    return {
      schemeId,
      stealthAddressBytes,
      ephemeralPublicKey,
      viewTag,
      ...(asset.length ? { asset } : {}),
      ...(amount.length ? { amount: bigEndian(amount) } : {}),
      sealed: sealed.length ? sealed : null,
    }
  } catch {
    return null
  }
}
