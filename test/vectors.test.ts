import { describe, expect, it } from 'vitest'
import { aptos } from '../src/chains/aptos/index.js'
import { evm } from '../src/chains/evm/stealth.js'
import { solana } from '../src/chains/solana/index.js'
import { stellar } from '../src/chains/stellar/index.js'
import { sui } from '../src/chains/sui/index.js'
import { fromHex, toHex } from '../src/core/bytes.js'
import { decodeEnvelope } from '../src/core/envelope.js'
import { deriveKeys, fromSignature, metaAddress, viewKeyOf } from '../src/core/keys.js'
import { createPayment, findPayment, openPaymentMemo, paymentPrivateKey } from '../src/core/stealth.js'
import type { Memo } from '../src/core/memo.js'
import type { ChainAdapter } from '../src/core/types.js'
import spec from './vectors/stealthkit-v1.json' with { type: 'json' }

const chains: Record<string, ChainAdapter> = { eth: evm, sol: solana, sui, aptos, stellar }

describe.each(spec.vectors.map((v) => [v.chain, v] as const))('conformance vectors: %s', (tag, v) => {
  const chain = chains[tag] as ChainAdapter
  const keys = deriveKeys(chain, fromSignature(fromHex(spec.input.signature)), spec.input.labels)

  it('reproduces every output from the fixed inputs', () => {
    expect(toHex(keys.spendingPrivateKey)).toBe(v.spendingPrivateKey)
    expect(toHex(keys.viewingPrivateKey)).toBe(v.viewingPrivateKey)
    expect(metaAddress(chain, keys)).toBe(v.metaAddress)
    const pay = createPayment(chain, v.metaAddress, {
      memo: spec.input.memo as Memo,
      ephemeralPrivateKey: fromHex(v.ephemeralPrivateKey),
      nonce: fromHex(spec.input.nonce),
    })
    expect(pay.stealthAddress).toBe(v.stealthAddress)
    expect(toHex(pay.ephemeralPublicKey)).toBe(v.ephemeralPublicKey)
    expect(pay.viewTag).toBe(v.viewTag)
    expect(toHex(paymentPrivateKey(chain, keys, pay.ephemeralPublicKey))).toBe(v.stealthPrivateKey)
    expect(pay.sealed && toHex(pay.sealed)).toBe(v.sealed)
  })

  it('finds and opens the vector’s payment from its envelope alone', () => {
    const envelope = decodeEnvelope(fromHex(v.envelope))
    expect(envelope?.schemeId).toBe(v.schemeId)
    const found = findPayment(chain, viewKeyOf(chain, keys), {
      ephemeralPublicKey: envelope?.ephemeralPublicKey as Uint8Array,
      viewTag: envelope?.viewTag as number,
    })
    expect(found).toBe(v.stealthAddress)
    expect(openPaymentMemo(chain, keys.viewingPrivateKey, { ephemeralPublicKey: fromHex(v.ephemeralPublicKey), stealthAddress: v.stealthAddress, sealed: fromHex(v.sealed as string) })).toEqual(spec.input.memo)
  })
})
