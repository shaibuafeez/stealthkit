// 3. Find your payments: scan the announcer's events on Monad with a view key.
//    VIEW_KEY=stealth-view:0x… BLOCKS=100 node examples/03-scan.mjs
import { createPublicClient, defineChain, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  monad,
  parseStealthViewKey,
  scanAnnouncements,
  stealthKeysFromSignature,
  viewKeyOf,
} from 'monad-stealth'

const chain = defineChain({
  id: monad.mainnet.chainId,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [monad.mainnet.rpcUrl] } },
})
const client = createPublicClient({ chain, transport: http() })
const view = process.env.VIEW_KEY
  ? parseStealthViewKey(process.env.VIEW_KEY)
  : viewKeyOf(stealthKeysFromSignature(await privateKeyToAccount(generatePrivateKey()).signMessage({ message: 'demo' })))

const latest = await client.getBlockNumber()
const blocks = BigInt(process.env.BLOCKS ?? 100)
const found = await scanAnnouncements({ client, view, fromBlock: latest - blocks + 1n, toBlock: latest })
console.log(`scanned blocks ${latest - blocks + 1n}–${latest}: ${found.length} payment(s) for this key`)
for (const p of found)
  console.log(`  ${p.stealthAddress}  ${p.amount === null ? '' : Number(p.amount) / 1e6}  ${monad.mainnet.explorer}/tx/${p.transactionHash}`)
