import type { Eip3009Token } from './gasless.js'

/**
 * Monad: chain ids, public RPCs, and the dollars that support gasless EIP-3009 transfers. Token
 * domains were read from each contract (EIP-5267) and checked against its DOMAIN_SEPARATOR.
 */
export const monad = {
  mainnet: {
    chainId: 143,
    rpcUrl: 'https://rpc.monad.xyz',
    explorer: 'https://monadscan.com',
    tokens: {
      AUSD: {
        address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
        domain: { name: 'Agora Dollar', version: '1' },
        decimals: 6,
      },
      USDC: {
        address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
        domain: { name: 'USDC', version: '2' },
        decimals: 6,
      },
    },
  },
  testnet: {
    chainId: 10143,
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    explorer: 'https://testnet.monadscan.com',
    tokens: {
      AUSD: {
        address: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',
        domain: { name: 'Agora Dollar', version: '1' },
        decimals: 6,
      },
      USDC: {
        address: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
        domain: { name: 'USDC', version: '2' },
        decimals: 6,
      },
    },
  },
} as const satisfies Record<
  string,
  { chainId: number; rpcUrl: string; explorer: string; tokens: Record<string, Eip3009Token> }
>
