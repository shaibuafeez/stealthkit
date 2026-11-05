import type { Bytes } from './bytes.js'
import { equal } from './bytes.js'
import { parseMetaAddress, type StealthKeys, type ViewKey } from './keys.js'
import { type Memo, openMemo, sealMemo } from './memo.js'
import type { ChainAdapter } from './types.js'

/**
 * One-time addresses: what a sender derives for every payment, and how its receiver finds and
 * opens it. Each is a pure function of keys and bytes; nothing touches a network.
 */

export interface Payment {
  /** The one-time address to pay. */
  stealthAddress: string
  /** Published with the payment so the receiver can find it. */
  ephemeralPublicKey: Bytes
  viewTag: number
  /** The sealed note, or null. */
  sealed: Bytes | null
}

/** A fresh one-time address for a meta-address, with an optional note sealed for its owner. */
export function createPayment(
  chain: ChainAdapter,
  meta: string,
  options: { memo?: Memo | null; memoLabel?: string; ephemeralPrivateKey?: Bytes; nonce?: Bytes } = {},
): Payment {
  const { spendingPublicKey, viewingPublicKey } = parseMetaAddress(chain, meta)
  const ephemeral = options.ephemeralPrivateKey ?? chain.scheme.randomPrivateKey()
  const shared = chain.scheme.sharedPoint(ephemeral, viewingPublicKey)
  const hashed = chain.scheme.hashedSecret(shared)
  const stealthAddress = chain.address(chain.scheme.stealthPublicKey(spendingPublicKey, hashed))
  return {
    stealthAddress,
    ephemeralPublicKey: chain.scheme.publicKey(ephemeral),
    viewTag: hashed[0] as number,
    sealed: options.memo
      ? sealMemo(chain, shared, stealthAddress, options.memo, { label: options.memoLabel, nonce: options.nonce })
      : null,
  }
}

/**
 * Whether a payment is for this view key: its one-time address, or null. The view tag is checked
 * first, so 255 of every 256 other people's payments cost one point multiplication and a hash.
 */
export function findPayment(
  chain: ChainAdapter,
  view: ViewKey,
  announcement: { ephemeralPublicKey: Bytes; viewTag: number; stealthAddress?: string },
): string | null {
  const shared = chain.scheme.sharedPoint(view.viewingPrivateKey, announcement.ephemeralPublicKey)
  const hashed = chain.scheme.hashedSecret(shared)
  if (hashed[0] !== announcement.viewTag) return null
  const address = chain.address(chain.scheme.stealthPublicKey(view.spendingPublicKey, hashed))
  if (
    announcement.stealthAddress !== undefined &&
    !equal(chain.addressBytes(address), chain.addressBytes(announcement.stealthAddress))
  )
    return null
  return address
}

/** The private key of a one-time address: only the holder of the spending key can make it. */
export function paymentPrivateKey(chain: ChainAdapter, keys: StealthKeys, ephemeralPublicKey: Bytes): Bytes {
  const shared = chain.scheme.sharedPoint(keys.viewingPrivateKey, ephemeralPublicKey)
  return chain.scheme.stealthPrivateKey(keys.spendingPrivateKey, chain.scheme.hashedSecret(shared))
}

/** Opens a payment's sealed note with the viewing key: null when there's none, or not for this key. */
export function openPaymentMemo(
  chain: ChainAdapter,
  viewingPrivateKey: Bytes,
  payment: { ephemeralPublicKey: Bytes; stealthAddress: string; sealed?: Bytes | null },
  label?: string,
): Memo | null {
  if (!payment.sealed) return null
  try {
    const shared = chain.scheme.sharedPoint(viewingPrivateKey, payment.ephemeralPublicKey)
    return openMemo(chain, shared, payment.stealthAddress, payment.sealed, label)
  } catch {
    return null
  }
}
