import type { Address } from 'viem'

/**
 * The exact messages Kova's wallets sign to make their stealth keys. Use these with
 * stealthKeysFromSignature (and the default labels) to make the same keys a Kova wallet has, for
 * example to pay a Kova user privately from your own app, or to build a Kova-compatible wallet.
 */

/** A person's private-receiving keys. */
export function kovaPersonalKeysMessage(wallet: Address): string {
  return `Kova private receiving\nWallet ${wallet.toLowerCase()}\n\nSign to open your private receiving keys. This only reads keys; it moves no money.`
}

/** A shop's private-takings keys (one set per shop, so one wallet's shops stay separate). */
export function kovaShopKeysMessage(shop: string): string {
  return `Kova private takings\nShop ${shop}\n\nSign to open this shop’s private takings keys. This only reads keys; it moves no money.`
}
