/** Small byte helpers, so the core depends on no chain library. */

export type Bytes = Uint8Array

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const utf8 = (text: string): Bytes => encoder.encode(text)
export const fromUtf8 = (bytes: Bytes): string => decoder.decode(bytes)

export function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export function equal(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

export function toHex(bytes: Bytes): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): Bytes {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error('Not hex')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export const bigEndian = (bytes: Bytes): bigint => (bytes.length ? BigInt(`0x${toHex(bytes)}`) : 0n)

export function littleEndian(bytes: Bytes): bigint {
  let n = 0n
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i] as number)
  return n
}

export function toBigEndian(n: bigint, length: number): Bytes {
  return fromHex(n.toString(16).padStart(length * 2, '0'))
}

export function toLittleEndian(n: bigint, length: number): Bytes {
  const out = new Uint8Array(length)
  let v = n
  for (let i = 0; i < length; i++) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}
