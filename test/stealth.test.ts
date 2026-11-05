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
} from '../src/index.js'

const wallet = privateKeyToAccount(generatePrivateKey())
const keys = stealthKeysFromSignature(await wallet.signMessage({ message: stealthKeysMessage('MyApp', 'Wallet 1') }))
const meta = stealthMetaAddress(keys)

describe('stealth addresses (ERC-5564 scheme 1)', () => {
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

  it('gives each scope its own keys, and reads Kova’s view keys too', async () => {
    const shop = stealthKeysFromSignature(await wallet.signMessage({ message: kovaShopKeysMessage('mer_ada') }))
    expect(stealthMetaAddress(shop)).not.toBe(meta)
    for (let i = 0; i < 20; i++) expect(checkStealthAddress(viewKeyOf(shop), generateStealthAddress(meta))).toBeNull()
    const kovaStyle = stealthViewKey(keys).replace('stealth-view:0x', 'kova-view:0x')
    expect(parseStealthViewKey(kovaStyle)).toEqual(parseStealthViewKey(stealthViewKey(keys)))
  })

  it('round-trips a meta-address through ERC-6538’s 66-byte form', () => {
    const bytes = metaAddressToBytes(meta)
    expect(bytes).toHaveLength(2 + 132)
    expect(metaAddressFromBytes(bytes)).toBe(meta)
  })

  it('refuses a malformed meta-address or view key', () => {
    expect(() => parseStealthMetaAddress('st:eth:0x1234')).toThrow()
    expect(() => parseStealthViewKey('stealth-view:0xzz')).toThrow()
  })
})

describe('sealed memos and announcements', () => {
  const keysFor = (n: number) => stealthKeysFromSignature(`0x${n.toString(16).padStart(2, '0').repeat(64)}1b` as Hex)

  it('seals a memo only the receiver’s viewing key opens, bound to its one-time address', () => {
    const keys = keysFor(7)
    const meta = stealthMetaAddress(keys)
    const ada = privateKeyToAccount(generatePrivateKey())
    const pay = generateStealthPayment(meta, { from: ada.address, name: 'Ada', note: 'Train tickets', kind: 'send' })
    expect(pay.sealed).toMatch(/^0x01/)
    expect(openStealthMemo(keys.viewingPrivateKey, pay)).toEqual({ from: ada.address, name: 'Ada', note: 'Train tickets', kind: 'send' })
    expect(openStealthMemo(keysFor(8).viewingPrivateKey, pay)).toBeNull()
    const other = generateStealthPayment(meta, null)
    expect(openStealthMemo(keys.viewingPrivateKey, { ...other, sealed: pay.sealed })).toBeNull()
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

  it('lays metadata out as ERC-5564 does for a token, then the sealed memo', () => {
    const pay = generateStealthPayment(stealthMetaAddress(keysFor(11)), { note: 'hi' })
    const token = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC'
    const parsed = parseStealthMetadata(stealthMetadata({ viewTag: pay.viewTag, token, amount: 4_500_000n, sealed: pay.sealed }))
    expect(parsed).toMatchObject({ viewTag: pay.viewTag, selector: '0xe3ee160e', token, amount: 4_500_000n, sealed: pay.sealed })
    expect(parseStealthMetadata(stealthMetadata({ viewTag: pay.viewTag, token, amount: 1n }))?.sealed).toBeNull()
  })
})
