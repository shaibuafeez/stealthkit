// 2. Send privately: a fresh one-time address for the receiver, a sealed note, and the announcement.
//    META=st:eth:0x… node examples/02-send.mjs
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  announceCalldata,
  ERC5564_ANNOUNCER,
  generateStealthPayment,
  monad,
  stealthKeysFromSignature,
  stealthMetaAddress,
} from 'monad-stealth'

// Without META, pay a throwaway receiver so the example runs on its own.
const meta =
  process.env.META ??
  stealthMetaAddress(
    stealthKeysFromSignature(await privateKeyToAccount(generatePrivateKey()).signMessage({ message: 'demo' })),
  )
const token = monad.mainnet.tokens.AUSD
const amount = 5_000_000n // $5.00 (6 decimals)

const payment = generateStealthPayment(meta, { name: 'Ada', note: 'For lunch' })
console.log('pay to          ', payment.stealthAddress, '(new for this payment; nobody can tell it is theirs)')
console.log('amount          ', `${Number(amount) / 1e6} AUSD`)
console.log('\nThen announce it, so the receiver can find it without any server:')
console.log('to              ', ERC5564_ANNOUNCER)
console.log('data            ', announceCalldata(payment, token.address, amount))
console.log('\nThe note "For lunch" is sealed inside: only the receiver’s viewing key opens it.')
