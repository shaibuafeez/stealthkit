// 1. Receive privately: make stealth keys from a wallet signature and publish the meta-address.
//    node examples/01-receive.mjs            (a throwaway wallet)
//    PRIVATE_KEY=0x… node examples/01-receive.mjs
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  ERC6538_REGISTRY,
  registerKeysCalldata,
  stealthKeysFromSignature,
  stealthKeysMessage,
  stealthMetaAddress,
  stealthViewKey,
} from 'stealthkit/evm'

const wallet = privateKeyToAccount(process.env.PRIVATE_KEY ?? generatePrivateKey())
// Any EVM wallet signs this the same way every time, so the keys need no storage.
const signature = await wallet.signMessage({ message: stealthKeysMessage('MyApp', wallet.address) })
const keys = stealthKeysFromSignature(signature)
const meta = stealthMetaAddress(keys)

console.log('wallet          ', wallet.address)
console.log('meta-address    ', meta)
console.log('                 (share it: anyone can pay you privately with it)')
console.log('view key        ', stealthViewKey(keys))
console.log('                 (finds your payments, cannot spend them: give it to an accountant)')
console.log('\nPublish it so senders only need your wallet address: send this to ERC-6538 on Monad mainnet')
console.log('to              ', ERC6538_REGISTRY)
console.log('data            ', `${registerKeysCalldata(meta).slice(0, 74)}…`)
