/**
 * The privacy router: where each payment comes from, decided for you, so private dollars are just
 * dollars and nothing ever has to be moved by hand. Kova's app and web run these same rules.
 *
 * Private dollars sit at one-time addresses only your keys can open. A payment can go straight from
 * one of them (Monad can't tie it to your wallet, and the change stays there, still private), from
 * your balance, or, when neither covers it alone, from your balance after just enough private
 * dollars move into it. That move is public on Monad, so it's the last resort, and kept small.
 */

/** One of your one-time addresses (`item`, whatever the caller keeps for it) and what it holds now, in base units. */
export interface PrivateHolding<T> {
  item: T
  held: bigint
}

/** Where a payment comes from, when someone chooses it themselves. */
export type PaySource = 'balance' | 'private'

/**
 * Which private dollars pay `amount`: the smallest single address that holds enough (the change
 * stays there, still private); else the fewest addresses, largest first, put together into one
 * first. Null when they don't cover it even together.
 */
export function planPrivateSpend<T>(
  holdings: readonly PrivateHolding<T>[],
  amount: bigint,
): { from: T } | { gather: T[] } | null {
  if (amount <= 0n) return null
  const funded = holdings.filter((h) => h.held > 0n)
  const order = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0)
  const enough = funded.filter((h) => h.held >= amount).sort((a, b) => order(a.held, b.held))
  if (enough[0]) return { from: enough[0].item }
  const gather: T[] = []
  let sum = 0n
  for (const h of [...funded].sort((a, b) => order(b.held, a.held))) {
    if (sum >= amount) break
    gather.push(h.item)
    sum += h.held
  }
  return sum >= amount ? { gather } : null
}

export type PaymentRoute<T> =
  /** The balance pays, as it always has. */
  | { from: 'balance' }
  /** Private dollars pay, straight from one address; `gather`: several are put together into one first. */
  | { from: 'private'; gather: boolean }
  /**
   * Neither covers it alone: these addresses move into the balance first, whole (`moving` in all,
   * at least the `shortfall`), and then the balance pays.
   */
  | { from: 'top-up'; move: T[]; moving: bigint; shortfall: bigint }
  /** Not enough, even all together: `need` more. */
  | { from: 'short'; need: bigint }

export interface RouteInput<T> {
  amount: bigint
  /** The wallet's balance; null until it's known. */
  balance: bigint | null
  /** Private dollars, address by address; none when this device can't open them. */
  holdings: readonly PrivateHolding<T>[]
  /**
   * Private dollars may pay this straight from their addresses: a private send, or a shop's charge
   * that doesn't tie a stamp card to your wallet. A plain send can't: the person paid would see a
   * stranger's address and no name.
   */
  direct: boolean
  /** A private send: spend private dollars first whenever one address covers it, and leave the balance be. */
  privateFirst?: boolean
  /** What the person chose themselves, under Details. Without a choice, the router decides. */
  choice?: PaySource | null
}

const sum = (holdings: readonly PrivateHolding<unknown>[]) =>
  holdings.reduce((total, h) => total + (h.held > 0n ? h.held : 0n), 0n)

/**
 * Where a payment of `amount` comes from. Private sends spend private dollars first when one address
 * covers it. Anything else uses the balance when it covers, else private dollars (one address if one
 * covers, several put together only when there's no other way). When neither covers alone but both
 * together do, just enough private dollars move into the balance first: the fewest addresses whose
 * dollars make up the shortfall.
 */
export function routePayment<T>({
  amount,
  balance,
  holdings,
  direct,
  privateFirst = false,
  choice = null,
}: RouteInput<T>): PaymentRoute<T> {
  if (amount <= 0n) return { from: 'balance' }
  const plan = direct ? planPrivateSpend(holdings, amount) : null
  const single = plan !== null && 'from' in plan
  const covers = balance !== null && balance >= amount
  const topUp = (): PaymentRoute<T> | null => {
    if (balance === null || covers) return null
    const shortfall = amount - balance
    const top = planPrivateSpend(holdings, shortfall)
    if (!top) return null
    const move = 'from' in top ? [top.from] : top.gather
    return {
      from: 'top-up',
      move,
      moving: sum(holdings.filter((h) => move.includes(h.item))),
      shortfall,
    }
  }

  if (choice === 'private' && plan) return { from: 'private', gather: !single }
  if (choice === 'balance') {
    if (covers) return { from: 'balance' }
    const up = topUp()
    if (up) return up
  }
  if (privateFirst && single) return { from: 'private', gather: false }
  if (covers || balance === null) return { from: 'balance' }
  if (plan) return { from: 'private', gather: !single }
  return topUp() ?? { from: 'short', need: amount - balance - sum(holdings) }
}
