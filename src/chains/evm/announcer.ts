import {
  type Address,
  concat,
  encodeFunctionData,
  getAddress,
  type Hex,
  type PublicClient,
  size,
  slice,
  toHex,
} from 'viem'
import {
  checkStealthAddress,
  metaAddressToBytes,
  STEALTH_SCHEME_ID,
  type StealthAnnouncement,
  type ViewKey,
} from './stealth.js'

/**
 * On chain: ERC-5564's announcer and ERC-6538's registry, both at their canonical addresses.
 *
 * The announcer's Announcement events are the public record of private payments: any wallet scans
 * them to find its own, with no server in between. The registry maps a wallet to its stealth
 * meta-address, so anyone can pay that wallet privately knowing only its address.
 *
 * On Monad: the announcer is deployed on mainnet and testnet; the registry on mainnet.
 */
export const ERC5564_ANNOUNCER: Address = '0x55649E01B5Df198D18D95b5cc5051630cfD45564'
export const ERC6538_REGISTRY: Address = '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538'

export const erc5564AnnouncerAbi = [
  {
    type: 'function',
    name: 'announce',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddress', type: 'address' },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Announcement',
    inputs: [
      { name: 'schemeId', type: 'uint256', indexed: true },
      { name: 'stealthAddress', type: 'address', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'ephemeralPubKey', type: 'bytes', indexed: false },
      { name: 'metadata', type: 'bytes', indexed: false },
    ],
  },
] as const

export const erc6538RegistryAbi = [
  {
    type: 'function',
    name: 'registerKeys',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthMetaAddress', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'stealthMetaAddressOf',
    stateMutability: 'view',
    inputs: [
      { name: 'registrant', type: 'address' },
      { name: 'schemeId', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes' }],
  },
] as const

/** transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32) */
export const TRANSFER_WITH_AUTHORIZATION_SELECTOR: Hex = '0xe3ee160e'

/**
 * An announcement's metadata, laid out as ERC-5564 recommends for a token: the view tag, the
 * function that moved the funds, the token and the amount; then, when there is one, the sealed memo.
 */
export function stealthMetadata(input: {
  viewTag: Hex
  token: Address
  amount: bigint
  sealed?: Hex | null
  selector?: Hex
}): Hex {
  return concat([
    input.viewTag,
    input.selector ?? TRANSFER_WITH_AUTHORIZATION_SELECTOR,
    input.token,
    toHex(input.amount, { size: 32 }),
    ...(input.sealed ? [input.sealed] : []),
  ])
}

export function parseStealthMetadata(
  metadata: Hex,
): { viewTag: Hex; selector: Hex; token: Address; amount: bigint; sealed: Hex | null } | null {
  if (size(metadata) < 57) return null
  return {
    viewTag: slice(metadata, 0, 1),
    selector: slice(metadata, 1, 5),
    token: getAddress(slice(metadata, 5, 25)),
    amount: BigInt(slice(metadata, 25, 57)),
    sealed: size(metadata) > 57 ? slice(metadata, 57) : null,
  }
}

/** The calldata that announces a payment (anyone can send it; whoever does pays the gas). */
export function announceCalldata(payment: StealthAnnouncement & { sealed?: Hex | null }, token: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc5564AnnouncerAbi,
    functionName: 'announce',
    args: [
      STEALTH_SCHEME_ID,
      payment.stealthAddress,
      payment.ephemeralPublicKey,
      stealthMetadata({ viewTag: payment.viewTag, token, amount, sealed: payment.sealed ?? null }),
    ],
  })
}

/** The calldata that publishes a wallet's meta-address in ERC-6538's registry. */
export function registerKeysCalldata(meta: string): Hex {
  return encodeFunctionData({
    abi: erc6538RegistryAbi,
    functionName: 'registerKeys',
    args: [STEALTH_SCHEME_ID, metaAddressToBytes(meta)],
  })
}

export interface FoundPayment {
  stealthAddress: Address
  ephemeralPublicKey: Hex
  viewTag: Hex
  token: Address | null
  amount: bigint | null
  sealed: Hex | null
  /** Who sent the announcement (often a relayer, not the payer). */
  caller: Address
  blockNumber: bigint
  transactionHash: Hex
}

/**
 * Scans the announcer's events between two blocks for payments this view key opens. Public RPCs
 * cap how many blocks one eth_getLogs may cover, so it asks in steps (Monad's public RPC: keep
 * `step` at 100 or less; an indexer or a paid RPC can go higher).
 */
export async function scanAnnouncements(input: {
  client: PublicClient
  view: ViewKey
  fromBlock: bigint
  toBlock: bigint
  step?: bigint
  announcer?: Address
}): Promise<FoundPayment[]> {
  const step = input.step ?? 100n
  const found: FoundPayment[] = []
  for (let from = input.fromBlock; from <= input.toBlock; from += step) {
    const to = from + step - 1n > input.toBlock ? input.toBlock : from + step - 1n
    const logs = await input.client.getContractEvents({
      address: input.announcer ?? ERC5564_ANNOUNCER,
      abi: erc5564AnnouncerAbi,
      eventName: 'Announcement',
      args: { schemeId: STEALTH_SCHEME_ID },
      fromBlock: from,
      toBlock: to,
    })
    for (const log of logs) {
      const { stealthAddress, ephemeralPubKey, metadata, caller } = log.args
      if (!stealthAddress || !ephemeralPubKey || !metadata || !caller) continue
      const meta = parseStealthMetadata(metadata)
      const viewTag = meta?.viewTag ?? slice(metadata, 0, 1)
      if (!checkStealthAddress(input.view, { ephemeralPublicKey: ephemeralPubKey, viewTag, stealthAddress }))
        continue
      found.push({
        stealthAddress,
        ephemeralPublicKey: ephemeralPubKey,
        viewTag,
        token: meta?.token ?? null,
        amount: meta?.amount ?? null,
        sealed: meta?.sealed ?? null,
        caller,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      })
    }
  }
  return found
}
