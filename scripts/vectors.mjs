/**
 * Writes the normative test vectors (test/vectors/stealthkit-v1.json): fixed inputs, and every
 * output an implementation must reproduce exactly, for each chain. A port to another language is
 * conformant when it matches every value. Run: pnpm vectors
 */
import { writeFileSync } from 'node:fs'
import { aptos } from '../dist/chains/aptos/index.js'
import { evm } from '../dist/chains/evm/stealth.js'
import { solana } from '../dist/chains/solana/index.js'
import { stellar } from '../dist/chains/stellar/index.js'
import { sui } from '../dist/chains/sui/index.js'
import { fromHex, toHex } from '../dist/core/bytes.js'
import { encodeEnvelope } from '../dist/core/envelope.js'
import { deriveKeys, encodeViewKey, fromSignature, metaAddress, viewKeyOf } from '../dist/core/keys.js'
import { createPayment, paymentPrivateKey } from '../dist/core/stealth.js'

const input = {
  signature: `${'11'.repeat(32)}${'22'.repeat(32)}1b`,
  labels: { spending: 'kova:stealth:spending', viewing: 'kova:stealth:viewing' },
  memoLabel: 'kova:stealth:memo:v1',
  memo: { name: 'Ada', note: 'Rent', kind: 'send' },
  nonce: '44'.repeat(24),
  amount: '25000000',
}

/** @param {import('../dist/core/types.js').ChainAdapter} chain @param {string} ephemeral */
const vector = (chain, ephemeral) => {
  const keys = deriveKeys(chain, fromSignature(fromHex(input.signature)), input.labels)
  const meta = metaAddress(chain, keys)
  const pay = createPayment(chain, meta, { memo: input.memo, ephemeralPrivateKey: fromHex(ephemeral), nonce: fromHex(input.nonce) })
  return {
    chain: chain.tag,
    scheme: chain.scheme.name,
    schemeId: chain.scheme.id,
    ephemeralPrivateKey: ephemeral,
    spendingPrivateKey: toHex(keys.spendingPrivateKey),
    viewingPrivateKey: toHex(keys.viewingPrivateKey),
    metaAddress: meta,
    viewKey: encodeViewKey(chain, viewKeyOf(chain, keys)),
    stealthAddress: pay.stealthAddress,
    ephemeralPublicKey: toHex(pay.ephemeralPublicKey),
    viewTag: pay.viewTag,
    stealthPrivateKey: toHex(paymentPrivateKey(chain, keys, pay.ephemeralPublicKey)),
    sealed: pay.sealed ? toHex(pay.sealed) : null,
    envelope: toHex(
      encodeEnvelope(chain, {
        schemeId: chain.scheme.id,
        stealthAddress: pay.stealthAddress,
        ephemeralPublicKey: pay.ephemeralPublicKey,
        viewTag: pay.viewTag,
        amount: BigInt(input.amount),
        sealed: pay.sealed,
      }),
    ),
  }
}

const ed25519Ephemeral = toHex(deriveKeys(solana, { spending: fromHex('33'.repeat(32)), viewing: fromHex('33'.repeat(32)) }, input.labels).spendingPrivateKey)
const out = {
  version: 1,
  note: 'Normative: an implementation of stealthkit v1 must reproduce every output from these inputs. Hex is lowercase without 0x.',
  input,
  vectors: [
    vector(evm, '33'.repeat(32)),
    ...[solana, sui, aptos, stellar].map((c) => vector(c, ed25519Ephemeral)),
  ],
}
writeFileSync(new URL('../test/vectors/stealthkit-v1.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`)
console.log(`wrote ${out.vectors.length} vectors`)
