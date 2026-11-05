/**
 * stealthkit: private payments on any chain.
 *
 * The core is chain-neutral (keys, meta-addresses, one-time addresses, view keys, sealed notes,
 * the announcement envelope, the privacy router). Chains plug in through an adapter:
 *
 *   import { evm } from 'stealthkit/evm'          // Monad, Ethereum, Base, … (ERC-5564)
 *   import { solana } from 'stealthkit/solana'
 *   import { sui } from 'stealthkit/sui'
 *   import { aptos } from 'stealthkit/aptos'
 *   import { stellar } from 'stealthkit/stellar'
 */
export * from './core/bytes.js'
export * from './core/envelope.js'
export * from './core/keys.js'
export * from './core/memo.js'
export * from './core/router.js'
export * from './core/stealth.js'
export type * from './core/types.js'
export { ed25519Scheme, signWithScalar, verifyEd25519 } from './schemes/ed25519.js'
export { secp256k1Scheme } from './schemes/secp256k1.js'
