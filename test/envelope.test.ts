import { describe, expect, it } from 'vitest'
import { solana } from '../src/chains/solana/index.js'
import { decodeEnvelope, encodeEnvelope } from '../src/core/envelope.js'
import { deriveKeys, fromSeed, metaAddress } from '../src/core/keys.js'
import { createPayment } from '../src/core/stealth.js'
import { utf8 } from '../src/core/bytes.js'

describe('the announcement envelope', () => {
  const meta = metaAddress(solana, deriveKeys(solana, fromSeed(new Uint8Array(32).fill(5))))
  const pay = createPayment(solana, meta, { memo: { note: 'Coffee' } })

  it('carries every field and reads back without knowing the chain', () => {
    const envelope = encodeEnvelope(solana, {
      schemeId: solana.scheme.id,
      stealthAddress: pay.stealthAddress,
      ephemeralPublicKey: pay.ephemeralPublicKey,
      viewTag: pay.viewTag,
      asset: utf8('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      amount: 2_500_000n,
      sealed: pay.sealed,
    })
    const back = decodeEnvelope(envelope)
    expect(back).toMatchObject({ schemeId: 0x0101, viewTag: pay.viewTag, amount: 2_500_000n, sealed: pay.sealed })
    expect(back?.stealthAddressBytes).toEqual(solana.addressBytes(pay.stealthAddress))
    expect(back?.ephemeralPublicKey).toEqual(pay.ephemeralPublicKey)
  })

  it('leaves out what a payment doesn’t carry, and refuses what isn’t an envelope', () => {
    const bare = decodeEnvelope(
      encodeEnvelope(solana, { schemeId: 0x0101, stealthAddress: pay.stealthAddress, ephemeralPublicKey: pay.ephemeralPublicKey, viewTag: pay.viewTag }),
    )
    expect(bare?.amount).toBeUndefined()
    expect(bare?.sealed).toBeNull()
    expect(decodeEnvelope(utf8('not an envelope at all'))).toBeNull()
    expect(decodeEnvelope(new Uint8Array([1, 1, 1, 99]))).toBeNull()
  })
})
