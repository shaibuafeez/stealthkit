import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/hashes/utils'
import { type Bytes, concat, fromUtf8, utf8 } from './bytes.js'
import type { ChainAdapter } from './types.js'

/**
 * Sealed notes: who paid and why, readable only by the receiver.
 *
 *   key      = scheme.memoKey(shared point, label)
 *   sealed   = 0x01 ‖ nonce (24) ‖ XChaCha20-Poly1305(key, nonce, aad = one-time address bytes)
 *
 * Bound to the one-time address as associated data, so a note copied onto another payment fails
 * to open. The body is JSON with known fields only; anything else is dropped when opened.
 */
export interface Memo {
  /** The sender's own address, as their chain writes it. */
  from?: string
  /** What the sender calls themselves. */
  name?: string
  note?: string
  /** 'change': the sender's own private funds, gathered into one new address of theirs. */
  kind?: 'send' | 'change'
  /** The sender's signature vouching for `from`, when the funds didn't come from that address. */
  proof?: string
}

export const MEMO_VERSION = 1
export const MEMO_NAME_MAX = 40
export const MEMO_NOTE_MAX = 60
/** Largest sealed note: the version, the nonce, 400 bytes of note and the tag. */
export const SEALED_MEMO_MAX = 1 + 24 + 400 + 16
/** Kova's label: notes sealed under it open in Kova, and the other way round. */
export const KOVA_MEMO_LABEL = 'kova:stealth:memo:v1'

const chars = (text: string, max: number) => [...text.trim()].slice(0, max).join('')

/** A memo from untrusted input: known fields, trimmed to their limits. */
export function cleanMemo(raw: unknown): Memo {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const memo: Memo = {}
  if (typeof m.from === 'string' && m.from.length > 0 && m.from.length <= 100) memo.from = m.from
  if (typeof m.name === 'string' && m.name.trim()) memo.name = chars(m.name, MEMO_NAME_MAX)
  if (typeof m.note === 'string' && m.note.trim()) memo.note = chars(m.note, MEMO_NOTE_MAX)
  if (m.kind === 'send' || m.kind === 'change') memo.kind = m.kind
  if (typeof m.proof === 'string' && /^0x[0-9a-fA-F]{2,260}$/.test(m.proof)) memo.proof = m.proof
  return memo
}

export function sealMemo(
  chain: ChainAdapter,
  sharedPoint: Bytes,
  stealthAddress: string,
  memo: Memo,
  options: { label?: string | undefined; nonce?: Bytes | undefined } = {},
): Bytes {
  const body = utf8(JSON.stringify(cleanMemo(memo)))
  if (body.length > SEALED_MEMO_MAX - 41) throw new Error('That note is too long to seal.')
  const nonce = options.nonce ?? randomBytes(24)
  if (nonce.length !== 24) throw new Error('A nonce is 24 bytes')
  const key = chain.scheme.memoKey(sharedPoint, options.label ?? KOVA_MEMO_LABEL)
  const box = xchacha20poly1305(key, nonce, chain.addressBytes(stealthAddress)).encrypt(body)
  return concat(new Uint8Array([MEMO_VERSION]), nonce, box)
}

/** Throws when the note isn't for this shared point and address. */
export function openMemo(
  chain: ChainAdapter,
  sharedPoint: Bytes,
  stealthAddress: string,
  sealed: Bytes,
  label?: string,
): Memo {
  if (sealed[0] !== MEMO_VERSION || sealed.length < 41 || sealed.length > SEALED_MEMO_MAX)
    throw new Error('Not a sealed note')
  const key = chain.scheme.memoKey(sharedPoint, label ?? KOVA_MEMO_LABEL)
  const body = xchacha20poly1305(key, sealed.slice(1, 25), chain.addressBytes(stealthAddress)).decrypt(sealed.slice(25))
  return cleanMemo(JSON.parse(fromUtf8(body)))
}
