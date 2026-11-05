// 6. Stellar: one-time G… addresses. A sender pays with a claimable balance for the one-time
//    address (no account or trustline needed yet); the receiver claims it in a transaction a relayer
//    fee-bumps and whose reserves it sponsors, so the receiver never holds XLM.
//    node examples/06-stellar.mjs
import { randomBytes } from 'node:crypto'
import { createPayment, deriveKeys, findPayment, fromSeed, metaAddress, paymentPrivateKey, utf8, viewKeyOf } from 'stealthkit'
import { signStellarTransaction, STELLAR_PUBLIC_NETWORK, stellar } from 'stealthkit/stellar'

const keys = deriveKeys(stellar, fromSeed(randomBytes(32)))
const payment = createPayment(stellar, metaAddress(stellar, keys))
console.log('claimant      ', payment.stealthAddress, '(a G… account id, new for this payment)')
console.log('found         ', findPayment(stellar, viewKeyOf(stellar, keys), payment) === payment.stealthAddress)

const key = paymentPrivateKey(stellar, keys, payment.ephemeralPublicKey)
const { hint, signature } = signStellarTransaction(key, STELLAR_PUBLIC_NETWORK, utf8('<claim transaction XDR>'))
console.log('decorated sig ', `hint ${Buffer.from(hint).toString('hex')}, ${signature.length} bytes`)
