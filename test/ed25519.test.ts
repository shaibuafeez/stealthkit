import { ed25519 } from '@noble/curves/ed25519'
import { describe, expect, it } from 'vitest'
import { aptos, aptosSigningMessage, signAptosTransaction } from '../src/chains/aptos/index.js'
import { signSolanaMessage, solana } from '../src/chains/solana/index.js'
import { signStellarTransaction, STELLAR_TEST_NETWORK, stellar, stellarTransactionHash } from '../src/chains/stellar/index.js'
import { signSuiTransaction, sui, suiTransactionDigest } from '../src/chains/sui/index.js'
import { fromHex, toHex, utf8 } from '../src/core/bytes.js'
import { deriveKeys, encodeViewKey, fromSeed, metaAddress, parseMetaAddress, parseViewKey, viewKeyOf } from '../src/core/keys.js'
import { createPayment, findPayment, openPaymentMemo, paymentPrivateKey } from '../src/core/stealth.js'
import type { ChainAdapter } from '../src/core/types.js'
import { ed25519Scheme } from '../src/schemes/ed25519.js'
import { base64 } from '@scure/base'

const seed = (n: number) => new Uint8Array(32).fill(n)
const chains: ChainAdapter[] = [solana, sui, aptos, stellar]

describe.each(chains.map((c) => [c.tag, c] as const))('%s: one-time addresses on ed25519', (_, chain) => {
  const keys = deriveKeys(chain, fromSeed(seed(1)))
  const meta = metaAddress(chain, keys)

  it('makes a meta-address under the chain’s tag, and reads it back', () => {
    expect(meta.startsWith(`st:${chain.tag}:0x`)).toBe(true)
    expect(parseMetaAddress(chain, meta).viewingPublicKey).toHaveLength(32)
  })

  it('gives every payment its own address, which only the receiver finds and can spend', () => {
    const view = viewKeyOf(chain, keys)
    const seen = new Set<string>()
    for (let i = 0; i < 25; i++) {
      const pay = createPayment(chain, meta)
      expect(seen.has(pay.stealthAddress)).toBe(false)
      seen.add(pay.stealthAddress)
      expect(findPayment(chain, view, pay)).toBe(pay.stealthAddress)
      const key = paymentPrivateKey(chain, keys, pay.ephemeralPublicKey)
      expect(chain.address(ed25519Scheme.publicKey(key))).toBe(pay.stealthAddress)
    }
  })

  it('stays invisible to anyone else’s keys', () => {
    const other = viewKeyOf(chain, deriveKeys(chain, fromSeed(seed(2))))
    for (let i = 0; i < 25; i++) expect(findPayment(chain, other, createPayment(chain, meta))).toBeNull()
  })

  it('seals a note only the receiver opens, bound to the address', () => {
    const pay = createPayment(chain, meta, { memo: { name: 'Ada', note: 'Rent' } })
    expect(openPaymentMemo(chain, keys.viewingPrivateKey, pay)).toEqual({ name: 'Ada', note: 'Rent' })
    const stranger = deriveKeys(chain, fromSeed(seed(3)))
    expect(openPaymentMemo(chain, stranger.viewingPrivateKey, pay)).toBeNull()
    const elsewhere = createPayment(chain, meta)
    expect(openPaymentMemo(chain, keys.viewingPrivateKey, { ...elsewhere, sealed: pay.sealed })).toBeNull()
  })

  it('round-trips a view key, which holds no spending secret', () => {
    const text = encodeViewKey(chain, viewKeyOf(chain, keys))
    expect(parseViewKey(chain, text)).toEqual(viewKeyOf(chain, keys))
    expect(text.includes(toHex(keys.spendingPrivateKey))).toBe(false)
  })
})

describe('ed25519: a one-time key signs like any key', () => {
  const keys = deriveKeys(solana, fromSeed(seed(9)))
  const pay = createPayment(solana, metaAddress(solana, keys))
  const key = paymentPrivateKey(solana, keys, pay.ephemeralPublicKey)
  const publicKey = ed25519Scheme.publicKey(key)

  it('Solana: the signature verifies under standard Ed25519, for the one-time address', () => {
    const message = utf8('a serialized Solana transaction message')
    const signature = signSolanaMessage(key, message)
    expect(ed25519.verify(signature, message, solana.addressBytes(pay.stealthAddress))).toBe(true)
    expect(signSolanaMessage(key, message)).toEqual(signature)
    expect(ed25519.verify(signature, utf8('another message'), publicKey)).toBe(false)
  })

  it('Sui: flag ‖ signature ‖ key over the intent digest', () => {
    const tx = utf8('bcs transaction bytes')
    const serialized = base64.decode(signSuiTransaction(key, tx))
    expect(serialized[0]).toBe(0)
    expect(serialized.slice(65)).toEqual(publicKey)
    expect(ed25519.verify(serialized.slice(1, 65), suiTransactionDigest(tx), publicKey)).toBe(true)
  })

  it('Aptos: signs the domain-separated transaction message', () => {
    const bcs = utf8('bcs raw transaction')
    expect(ed25519.verify(signAptosTransaction(key, bcs), aptosSigningMessage(bcs), publicKey)).toBe(true)
  })

  it('Stellar: a decorated signature over the network’s transaction hash', () => {
    const xdr = utf8('transaction xdr')
    const { hint, signature } = signStellarTransaction(key, STELLAR_TEST_NETWORK, xdr)
    expect(hint).toEqual(publicKey.slice(-4))
    expect(ed25519.verify(signature, stellarTransactionHash(STELLAR_TEST_NETWORK, xdr), publicKey)).toBe(true)
  })
})

describe('ed25519: addresses as each chain writes them', () => {
  it('Stellar’s StrKey for the zero key is the well-known GAAAA…WHF', () => {
    expect(stellar.address(new Uint8Array(32))).toBe('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
    expect(() => stellar.addressBytes('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHG')).toThrow()
  })

  it('Solana writes the key in base58; Sui and Aptos hash it with their scheme flag', () => {
    const publicKey = ed25519Scheme.publicKey(deriveKeys(solana, fromSeed(seed(4))).spendingPrivateKey)
    expect(solana.addressBytes(solana.address(publicKey))).toEqual(publicKey)
    expect(sui.address(publicKey)).toMatch(/^0x[0-9a-f]{64}$/)
    expect(aptos.address(publicKey)).toMatch(/^0x[0-9a-f]{64}$/)
    expect(sui.address(publicKey)).not.toBe(aptos.address(publicKey))
  })

  it('refuses a meta-address with a point outside the prime-order group', () => {
    // A point of order 8: a small-subgroup trick a malicious receiver could try on a sender.
    const small = '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05'
    const good = toHex(ed25519Scheme.publicKey(fromHex('01'.padEnd(64, '0'))))
    expect(() => parseMetaAddress(solana, `st:sol:0x${small}${good}`)).toThrow()
    expect(() => parseMetaAddress(solana, `st:sol:0x${good}${small}`)).toThrow()
  })
})
