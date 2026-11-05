# Security

stealthkit handles keys that control money. Please report vulnerabilities privately, never in a
public issue.

**Report:** open a [GitHub security advisory](../../security/advisories/new) on this repository.
Include what you found, how to reproduce it, and its impact. You'll get an answer within three days.

**In scope:** key derivation, the stealth schemes (secp256k1 and ed25519), raw-scalar signing,
sealed notes, the envelope, point validation, and anything that could let someone other than a
receiver find, read or move its payments.

**Status:** not yet audited. The cryptography is from `@noble/curves` and `@noble/hashes`
(independently audited) and `@noble/ciphers`. The ed25519 scheme and raw-scalar signing are the
parts most in need of independent review; see DESIGN.md §5.2 and §12.
