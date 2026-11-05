import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import {
  checkStealthAddress,
  generateStealthAddress,
  generateStealthPayment,
  kovaShopKeysMessage,
  memoProofMessage,
  metaAddressFromBytes,
  metaAddressToBytes,
  openStealthMemo,
  parseStealthMetaAddress,
  parseStealthMetadata,
  parseStealthViewKey,
  stealthKeysFromSignature,
  stealthKeysMessage,
  stealthMetaAddress,
  stealthMetadata,
  stealthPrivateKey,
  stealthSender,
  stealthViewKey,
  viewKeyOf,
} from '../src/chains/evm/index.js'
import kova from './vectors/kova-evm.json' with { type: 'json' }

const wallet = privateKeyToAccount(generatePrivateKey())
const keys = stealthKeysFromSignature(await wallet.signMessage({ message: stealthKeysMessage('MyApp', 'Wallet 1') }))
const meta = stealthMetaAddress(keys)

describe('EVM: ERC-5564 scheme 1', () => {
  it('makes the same keys from the same wallet every time, with nothing stored', async () => {
    const again = stealthKeysFromSignature(await wallet.signMessage({ message: stealthKeysMessage('MyApp', 'Wallet 1') }))
    expect(again).toEqual(keys)
    expect(meta).toMatch(/^st:eth:0x[0-9a-f]{132}$/)
    expect(parseStealthMetaAddress(meta).spendingPublicKey).toHaveLength(68)
  })

  it('gives every payment its own address, which only the receiver can find and open', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const pay = generateStealthAddress(meta)
      expect(seen.has(pay.stealthAddress)).toBe(false)
      seen.add(pay.stealthAddress)
      expect(checkStealthAddress(viewKeyOf(keys), pay)).toBe(pay.stealthAddress)
      expect(privateKeyToAccount(stealthPrivateKey(keys, pay.ephemeralPublicKey)).address).toBe(pay.stealthAddress)
    }
  })

  it('stays invisible to anyone else’s keys', async () => {
    const other = stealthKeysFromSignature(
      await privateKeyToAccount(generatePrivateKey()).signMessage({ message: stealthKeysMessage('MyApp', 'Wallet 1') }),
    )
    for (let i = 0; i < 40; i++) expect(checkStealthAddress(viewKeyOf(other), generateStealthAddress(meta))).toBeNull()
  })

  it('lets a view key find every payment without being able to spend', () => {
    const view = parseStealthViewKey(stealthViewKey(keys))
    expect(view.viewingPrivateKey).toBe(keys.viewingPrivateKey)
    const pay = generateStealthAddress(meta)
    expect(checkStealthAddress(view, pay)).toBe(pay.stealthAddress)
    expect(stealthViewKey(keys)).not.toContain(keys.spendingPrivateKey.slice(2))
  })

  it('gives each scope its own keys', async () => {
    const shop = stealthKeysFromSignature(await wallet.signMessage({ message: kovaShopKeysMessage('mer_ada') }))
    expect(stealthMetaAddress(shop)).not.toBe(meta)
    for (let i = 0; i < 20; i++) expect(checkStealthAddress(viewKeyOf(shop), generateStealthAddress(meta))).toBeNull()
  })

  it('round-trips a meta-address through ERC-6538’s 66-byte form', () => {
    expect(metaAddressFromBytes(metaAddressToBytes(meta))).toBe(meta)
  })

  it('refuses a malformed meta-address or view key', () => {
    expect(() => parseStealthMetaAddress('st:eth:0x1234')).toThrow()
    expect(() => parseStealthViewKey('stealth-view:eth:0xzz')).toThrow()
  })
})

describe('EVM: byte-for-byte what Kova runs on Monad', () => {
  const ours = stealthKeysFromSignature(kova.signature as Hex)
  const pay = generateStealthPayment(kova.metaAddress, null, { ephemeralPrivateKey: kova.ephemeralPrivateKey as Hex })

  it('makes Kova’s keys, meta-address, one-time address and key from the same inputs', () => {
    expect(ours).toEqual({ spendingPrivateKey: kova.spendingPrivateKey, viewingPrivateKey: kova.viewingPrivateKey })
    expect(stealthMetaAddress(ours)).toBe(kova.metaAddress)
    expect(pay.stealthAddress).toBe(kova.stealthAddress)
    expect(pay.ephemeralPublicKey).toBe(kova.ephemeralPublicKey)
    expect(pay.viewTag).toBe(kova.viewTag)
    expect(stealthPrivateKey(ours, pay.ephemeralPublicKey)).toBe(kova.stealthPrivateKey)
  })

  it('reads Kova’s view keys and opens a note Kova sealed', () => {
    expect(parseStealthViewKey(kova.viewKey)).toEqual(viewKeyOf(ours))
    const memo = openStealthMemo(ours.viewingPrivateKey, { ...pay, sealed: kova.sealedByKova as Hex })
    expect(memo).toEqual(kova.memo)
  })
})

describe('EVM: sealed notes and announcements', () => {
  const keysFor = (n: number) => stealthKeysFromSignature(`0x${n.toString(16).padStart(2, '0').repeat(64)}1b` as Hex)

  it('seals a note only the receiver’s viewing key opens, bound to its one-time address', () => {
    const k = keysFor(7)
    const m = stealthMetaAddress(k)
    const ada = privateKeyToAccount(generatePrivateKey())
    const pay = generateStealthPayment(m, { from: ada.address, name: 'Ada', note: 'Train tickets', kind: 'send' })
    expect(pay.sealed).toMatch(/^0x01/)
    expect(openStealthMemo(k.viewingPrivateKey, pay)).toEqual({ from: ada.address, name: 'Ada', note: 'Train tickets', kind: 'send' })
    expect(openStealthMemo(keysFor(8).viewingPrivateKey, pay)).toBeNull()
    const other = generateStealthPayment(m, null)
    expect(openStealthMemo(k.viewingPrivateKey, { ...other, sealed: pay.sealed })).toBeNull()
    expect(other.sealed).toBeNull()
  })

  it('says who a payment is from, and how sure that is', async () => {
    const ada = privateKeyToAccount(generatePrivateKey())
    const pay = generateStealthPayment(stealthMetaAddress(keysFor(9)), null)
    const proof = await ada.signMessage({ message: memoProofMessage(pay.stealthAddress) })
    const elsewhere = privateKeyToAccount(generatePrivateKey()).address
    expect((await stealthSender({ from: ada.address }, { stealthAddress: pay.stealthAddress, from: ada.address }))?.proven).toBe('chain')
    expect((await stealthSender({ from: ada.address, proof }, { stealthAddress: pay.stealthAddress, from: elsewhere }))?.proven).toBe('signed')
    const forged = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: memoProofMessage(pay.stealthAddress) })
    expect((await stealthSender({ from: ada.address, proof: forged }, { stealthAddress: pay.stealthAddress, from: elsewhere }))?.proven).toBe('claimed')
  })

  it('lays metadata out as ERC-5564 does for a token, then the sealed note', () => {
    const pay = generateStealthPayment(stealthMetaAddress(keysFor(11)), { note: 'hi' })
    const token = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC'
    const parsed = parseStealthMetadata(stealthMetadata({ viewTag: pay.viewTag, token, amount: 4_500_000n, sealed: pay.sealed }))
    expect(parsed).toMatchObject({ viewTag: pay.viewTag, selector: '0xe3ee160e', token, amount: 4_500_000n, sealed: pay.sealed })
    expect(parseStealthMetadata(stealthMetadata({ viewTag: pay.viewTag, token, amount: 1n }))?.sealed).toBeNull()
  })
})
