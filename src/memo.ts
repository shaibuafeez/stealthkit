import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import {
  type Address,
  bytesToHex,
  bytesToString,
  concat,
  getAddress,
  type Hex,
  hexToBytes,
  isAddress,
  isAddressEqual,
  keccak256,
  recoverMessageAddress,
  stringToBytes,
} from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import {
  generateStealthAddress,
  parseStealthMetaAddress,
  type StealthAnnouncement,
  sharedSecret,
} from './stealth.js'

/**
 * Sealed memos: who sent a private payment, and a note, readable only by the receiver.
 *
 * The memo is encrypted (XChaCha20-Poly1305) with a key hashed from the same ECDH shared secret
 * that makes the one-time address, and bound to that address as associated data. Only the
 * receiver's viewing key opens it, nobody has to ask a server who paid, and a memo copied onto
 * another payment fails to open.
 */

/** Longest name a memo carries, in characters. */
export const MEMO_NAME_MAX = 40
/** Longest note, in characters. */
export const MEMO_NOTE_MAX = 60
/** Largest sealed memo, in bytes: the version, the nonce, up to 400 bytes of memo and the tag. */
export const SEALED_MEMO_MAX = 1 + 24 + 400 + 16
const MEMO_VERSION = 1

/** The label the memo key is hashed under. Kova's by default, so the two read each other's memos. */
export const KOVA_MEMO_LABEL = 'kova:stealth:memo:v1'

export interface StealthMemo {
  /** The sender's own wallet. */
  from?: Address
  /** What the sender calls themselves. */
  name?: string
  note?: string
  /** 'change': the sender's own private dollars, gathered into one new address of theirs. */
  kind?: 'send' | 'change'
  /**
   * When the dollars came from the sender's own private dollars (not their wallet), their wallet's
   * signature of memoProofMessage(the one-time address), so nobody can claim to be someone else.
   */
  proof?: Hex
}

/** What a sender's wallet signs to vouch, inside a memo, that a payment from private dollars is theirs. */
export function memoProofMessage(stealthAddress: Address, app = 'Kova'): string {
  return `${app} private send\nTo ${stealthAddress.toLowerCase()}`
}

const chars = (text: string, max: number) => [...text.trim()].slice(0, max).join('')

function cleanMemo(raw: unknown): StealthMemo {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const memo: StealthMemo = {}
  if (typeof m.from === 'string' && isAddress(m.from)) memo.from = getAddress(m.from)
  if (typeof m.name === 'string' && m.name.trim()) memo.name = chars(m.name, MEMO_NAME_MAX)
  if (typeof m.note === 'string' && m.note.trim()) memo.note = chars(m.note, MEMO_NOTE_MAX)
  if (m.kind === 'send' || m.kind === 'change') memo.kind = m.kind
  if (typeof m.proof === 'string' && /^0x[0-9a-fA-F]{130}$/.test(m.proof)) memo.proof = m.proof as Hex
  return memo
}

const memoKey = (shared: Uint8Array, label: string) =>
  hexToBytes(keccak256(concat([bytesToHex(shared), bytesToHex(stringToBytes(label))])))

export interface StealthPayment extends StealthAnnouncement {
  /** The sealed memo, or null when the payment carries none. */
  sealed: Hex | null
}

/** A fresh one-time address for a meta-address, with the memo sealed for its owner. */
export function generateStealthPayment(
  meta: string,
  memo?: StealthMemo | null,
  options: { ephemeralPrivateKey?: Hex; label?: string } = {},
): StealthPayment {
  const ephemeral = options.ephemeralPrivateKey ?? generatePrivateKey()
  const announcement = generateStealthAddress(meta, ephemeral)
  if (!memo) return { ...announcement, sealed: null }
  const shared = sharedSecret(ephemeral, parseStealthMetaAddress(meta).viewingPublicKey)
  const body = stringToBytes(JSON.stringify(cleanMemo(memo)))
  if (body.length > SEALED_MEMO_MAX - 41) throw new Error('That memo is too long to seal.')
  const nonce = hexToBytes(generatePrivateKey()).slice(0, 24)
  const box = xchacha20poly1305(
    memoKey(shared, options.label ?? KOVA_MEMO_LABEL),
    nonce,
    hexToBytes(announcement.stealthAddress),
  ).encrypt(body)
  return { ...announcement, sealed: bytesToHex(new Uint8Array([MEMO_VERSION, ...nonce, ...box])) }
}

/** Opens a payment's memo with the viewing key: null when there is none, or it isn't for this key. */
export function openStealthMemo(
  viewingPrivateKey: Hex,
  payment: { ephemeralPublicKey: Hex; stealthAddress: Address; sealed: Hex | null | undefined },
  label: string = KOVA_MEMO_LABEL,
): StealthMemo | null {
  if (!payment.sealed) return null
  try {
    const bytes = hexToBytes(payment.sealed)
    if (bytes[0] !== MEMO_VERSION || bytes.length < 41 || bytes.length > SEALED_MEMO_MAX) return null
    const shared = sharedSecret(viewingPrivateKey, payment.ephemeralPublicKey)
    const body = xchacha20poly1305(
      memoKey(shared, label),
      bytes.slice(1, 25),
      hexToBytes(payment.stealthAddress),
    ).decrypt(bytes.slice(25))
    return cleanMemo(JSON.parse(bytesToString(body)))
  } catch {
    return null
  }
}

/**
 * Who a private payment is from, and how sure that is: 'chain' when the chain shows it left their
 * wallet, 'signed' when their wallet signed for it, 'claimed' when only the memo says so (show it
 * as unconfirmed), and null when there's no telling.
 */
export async function stealthSender(
  memo: StealthMemo | null,
  payment: { stealthAddress: Address; from?: Address | null },
  app = 'Kova',
): Promise<{ address: Address; name: string | null; proven: 'chain' | 'signed' | 'claimed' } | null> {
  const name = memo?.name ?? null
  if (memo?.from) {
    if (payment.from && isAddressEqual(payment.from, memo.from))
      return { address: memo.from, name, proven: 'chain' }
    if (memo.proof) {
      const signer = await recoverMessageAddress({
        message: memoProofMessage(payment.stealthAddress, app),
        signature: memo.proof,
      }).catch(() => null)
      if (signer && isAddressEqual(signer, memo.from)) return { address: memo.from, name, proven: 'signed' }
    }
    return { address: memo.from, name, proven: 'claimed' }
  }
  return payment.from ? { address: getAddress(payment.from), name, proven: 'chain' } : null
}
