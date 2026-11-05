import { describe, expect, it } from 'vitest'
import { type PrivateHolding, planPrivateSpend, routePayment } from '../src/router.js'

const $ = (dollars: number) => BigInt(Math.round(dollars * 1e6))
const at = (...amounts: number[]): PrivateHolding<string>[] =>
  amounts.map((d, i) => ({ item: `a${i}`, held: $(d) }))

describe('planPrivateSpend', () => {
  it('pays from the smallest single address that holds enough', () => {
    expect(planPrivateSpend(at(5, 1.2, 2), $(1))).toEqual({ from: 'a1' })
    expect(planPrivateSpend(at(5, 1.2, 2), $(1.5))).toEqual({ from: 'a2' })
  })

  it('puts the fewest together, largest first, when no one address covers it', () => {
    expect(planPrivateSpend(at(0.5, 2, 1), $(2.5))).toEqual({ gather: ['a1', 'a2'] })
    expect(planPrivateSpend(at(0.5, 2, 1), $(3.5))).toEqual({ gather: ['a1', 'a2', 'a0'] })
  })

  it('skips empty addresses, and says null when they never cover it', () => {
    expect(planPrivateSpend(at(0, 1), $(1))).toEqual({ from: 'a1' })
    expect(planPrivateSpend(at(0.5, 0.25), $(1))).toBeNull()
    expect(planPrivateSpend(at(1), 0n)).toBeNull()
  })
})

describe('routePayment', () => {
  it('uses the balance for a shop when it covers, even with private dollars to spare', () => {
    expect(routePayment({ amount: $(2), balance: $(5), holdings: at(3), direct: true })).toEqual({
      from: 'balance',
    })
  })

  it('spends private dollars first on a private send, when one address covers it', () => {
    expect(
      routePayment({
        amount: $(1),
        balance: $(5),
        holdings: at(1.5),
        direct: true,
        privateFirst: true,
      }),
    ).toEqual({
      from: 'private',
      gather: false,
    })
  })

  it('keeps a private send on the balance rather than putting addresses together', () => {
    expect(
      routePayment({
        amount: $(2),
        balance: $(5),
        holdings: at(1, 1.5),
        direct: true,
        privateFirst: true,
      }),
    ).toEqual({
      from: 'balance',
    })
  })

  it('puts private dollars together only when nothing else pays', () => {
    expect(
      routePayment({
        amount: $(2),
        balance: $(0.5),
        holdings: at(1, 1.5),
        direct: true,
        privateFirst: true,
      }),
    ).toEqual({
      from: 'private',
      gather: true,
    })
    expect(
      routePayment({ amount: $(2), balance: $(0.5), holdings: at(1, 1.5), direct: true }),
    ).toEqual({ from: 'private', gather: true })
  })

  it('pays a shop from private dollars when the balance is short and they cover it', () => {
    expect(routePayment({ amount: $(2), balance: $(1), holdings: at(3), direct: true })).toEqual({
      from: 'private',
      gather: false,
    })
  })

  it('moves just enough in first when neither covers it alone', () => {
    // A stamp-card order (not direct): the smallest address that makes up the $0.50 moves, whole.
    const route = routePayment({
      amount: $(1.5),
      balance: $(1),
      holdings: at(4, 0.75, 0.6),
      direct: false,
    })
    expect(route).toEqual({ from: 'top-up', move: ['a2'], moving: $(0.6), shortfall: $(0.5) })
    // Neither alone: $1 in the balance, $0.75 and $0.6 private, $2 to pay.
    expect(
      routePayment({ amount: $(2), balance: $(1), holdings: at(0.75, 0.6), direct: true }),
    ).toEqual({
      from: 'top-up',
      move: ['a0', 'a1'],
      moving: $(1.35),
      shortfall: $(1),
    })
  })

  it('says how much more is needed when everything together falls short', () => {
    expect(routePayment({ amount: $(5), balance: $(1), holdings: at(1, 1), direct: true })).toEqual(
      { from: 'short', need: $(2) },
    )
    expect(routePayment({ amount: $(5), balance: $(1), holdings: [], direct: true })).toEqual({
      from: 'short',
      need: $(4),
    })
  })

  it('follows a choice made under Details, when it can', () => {
    expect(
      routePayment({
        amount: $(1),
        balance: $(5),
        holdings: at(2),
        direct: true,
        choice: 'private',
      }),
    ).toEqual({
      from: 'private',
      gather: false,
    })
    expect(
      routePayment({
        amount: $(1),
        balance: $(5),
        holdings: at(2),
        direct: true,
        privateFirst: true,
        choice: 'balance',
      }),
    ).toEqual({
      from: 'balance',
    })
    // The balance, chosen, when it's short: just enough moves in first.
    expect(
      routePayment({
        amount: $(2),
        balance: $(1),
        holdings: at(3),
        direct: true,
        choice: 'balance',
      }),
    ).toEqual({
      from: 'top-up',
      move: ['a0'],
      moving: $(3),
      shortfall: $(1),
    })
    // Private dollars, chosen, where they can't pay directly: the router decides.
    expect(
      routePayment({
        amount: $(1),
        balance: $(5),
        holdings: at(2),
        direct: false,
        choice: 'private',
      }),
    ).toEqual({ from: 'balance' })
  })

  it('waits on the balance while it loads, and pays nothing for free', () => {
    expect(routePayment({ amount: $(1), balance: null, holdings: at(2), direct: true })).toEqual({
      from: 'balance',
    })
    expect(
      routePayment({
        amount: $(1),
        balance: null,
        holdings: at(2),
        direct: true,
        privateFirst: true,
      }),
    ).toEqual({
      from: 'private',
      gather: false,
    })
    expect(routePayment({ amount: 0n, balance: $(0), holdings: at(2), direct: true })).toEqual({
      from: 'balance',
    })
  })
})
