// 5. Solana: the same three moves on ed25519. A one-time address is a Solana address; it signs a
//    transaction whose fee payer is a relayer, so it never needs SOL.
//    node examples/05-solana.mjs
import { randomBytes } from 'node:crypto'
import {
  createPayment,
  deriveKeys,
  findPayment,
  fromSeed,
  metaAddress,
  openPaymentMemo,
  paymentPrivateKey,
  utf8,
  verifyEd25519,
  viewKeyOf,
} from 'stealthkit'
import { signSolanaMessage, solana } from 'stealthkit/solana'

// The receiver's keys, from a secret it already has (a passkey's PRF output, a seed phrase…).
const keys = deriveKeys(solana, fromSeed(randomBytes(32)))
const meta = metaAddress(solana, keys)
console.log('meta-address  ', `${meta.slice(0, 34)}…`)

// A sender pays a fresh address and seals a note.
const payment = createPayment(solana, meta, { memo: { name: 'Ada', note: 'Rent' } })
console.log('pay to        ', payment.stealthAddress, '(a normal Solana address, new for this payment)')

// The receiver finds it with the viewing key and reads the note.
console.log('found         ', findPayment(solana, viewKeyOf(solana, keys), payment) === payment.stealthAddress)
console.log('note          ', openPaymentMemo(solana, keys.viewingPrivateKey, payment))

// And spends it: the one-time key signs the transaction message; the relayer is the fee payer.
const key = paymentPrivateKey(solana, keys, payment.ephemeralPublicKey)
const message = utf8('<a serialized Solana transaction message>')
const signature = signSolanaMessage(key, message)
console.log('signature ok  ', verifyEd25519(signature, message, solana.addressBytes(payment.stealthAddress)))
