// 4. Spend without gas: the one-time address signs an EIP-3009 transfer; any relayer submits it.
//    node examples/04-spend.mjs   (shows the whole thing with throwaway keys)
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  generateStealthPayment,
  monad,
  signStealthTransfer,
  stealthKeysFromSignature,
  stealthMetaAddress,
  stealthPrivateKey,
} from 'stealthkit/evm'

const keys = stealthKeysFromSignature(await privateKeyToAccount(generatePrivateKey()).signMessage({ message: 'demo' }))
const payment = generateStealthPayment(stealthMetaAddress(keys)) // as a sender would have made it

// The receiver, holding its keys, opens the one-time address's private key…
const key = stealthPrivateKey(keys, payment.ephemeralPublicKey)
// …and signs a transfer out of it. It holds no MON, and needs none.
const to = privateKeyToAccount(generatePrivateKey()).address
const signed = await signStealthTransfer({
  stealthPrivateKey: key,
  token: monad.mainnet.tokens.AUSD,
  chainId: monad.mainnet.chainId,
  to,
  value: 5_000_000n,
})
console.log('from (one-time) ', signed.authorization.from)
console.log('to              ', to)
console.log('valid until     ', new Date(Number(signed.authorization.validBefore) * 1000).toISOString())
console.log('\nA relayer sends this to the token and pays the gas; it can’t change where the money goes:')
console.log('to              ', monad.mainnet.tokens.AUSD.address)
console.log('data            ', `${signed.calldata.slice(0, 74)}…`)
