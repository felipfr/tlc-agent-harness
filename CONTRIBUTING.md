# Contributing

## License

PolyForm Noncommercial 1.0.0 (`LICENSE`, `NOTICE`).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/felipfr/tlc-agent-harness/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/felipfr/tlc-agent-harness/main/install.ps1 | iex
```

Target path: `~/.tlc/harness`.

## Contribute from a clone

```bash
git clone https://github.com/felipfr/tlc-agent-harness.git
cd tlc-agent-harness
./install.sh
./bin/tlc-build
```

## Checks

The gate is a single command:

```bash
tlc harness test
```

Which runs, in order: `biome check`, `tsc --noEmit`, the `src/**/__test__/*.test.ts` suite, the
`tools/__test__/*.test.ts` suite (a flat glob — new tool tests must live directly under
`tools/__test__/`), `tools/check-boundaries.ts`, and `tools/check-docs-bundle.ts`.

Equivalent by hand, for local debugging:

```bash
npx biome check
npx tsc --noEmit
node --test "src/**/__test__/*.test.ts"
node --test "tools/__test__/*.test.ts"
node tools/check-boundaries.ts
node tools/check-docs-bundle.ts
```

## Conventions

- Prefer clear names over narrating comments.
- Do not add lint suppressions to silence gates.
- Ship claims use `HARNESS_SHIP_CLAIM: …` only.
- `core/` and `contracts/` never contain a vendor identifier (`cursor`, `claude`, `codex`, `composer`,
  `anthropic`) — see [`docs/decisions/ad-004.md`](docs/decisions/ad-004.md) and
  [`docs/decisions/ad-007.md`](docs/decisions/ad-007.md).
- Documentation under `docs/` is an OKF v0.1 bundle — new docs need `type`/`title`/`description`/`tags`/
  `timestamp` frontmatter and absolute bundle-relative links. See
  [`docs/decisions/ad-013.md`](docs/decisions/ad-013.md).

## Price catalogs

See `tlc harness help prices` or [`docs/measure.md`](docs/measure.md).
