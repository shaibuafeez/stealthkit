# Contributing

Thank you for helping make private payments work everywhere.

## Ground rules

- **The core stays chain-neutral.** Nothing under `src/core` may name a chain or import a chain
  library. If a change needs to, it belongs in a `ChainAdapter`, a scheme, a transport or a sponsor.
- **Wire formats are versioned, never reinterpreted.** A change to a sealed note, the envelope or a
  scheme is a new version byte or scheme id, with the old one still read.
- **Vectors are normative.** If `pnpm vectors` changes `test/vectors/stealthkit-v1.json`, say why in
  the pull request: it breaks every other implementation.
- **Kova compatibility holds.** `test/vectors/kova-evm.json` must keep passing.

## Adding a chain

Follow [DESIGN.md §14](DESIGN.md#14-adding-a-chain). A new chain lands with: its adapter in
`src/chains/<chain>`, a subpath export in `package.json`, its signing helper, a test that its
one-time signatures verify under the chain's standard verifier, a test that a known address encodes
exactly as the chain's own tools encode it, and its vector in `scripts/vectors.mjs`.

## Before you open a pull request

```bash
pnpm typecheck && pnpm test && pnpm build
```
