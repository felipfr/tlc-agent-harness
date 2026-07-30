---
type: Aggregate
title: "Decisions index"
description: "Index of every architectural decision (AD-001…AD-020) made while building the multi-provider harness."
tags: [decisions, index]
timestamp: "2026-07-29"
---

# Decisions

Each architectural decision (AD) lives in its own file, cross-linked from here. This index replaces the
`## Decisions` section that used to live in `.specs/STATE.md` — see [/index.md](/index.md) for the rest of
the documentation bundle. `.specs/STATE.md` (outside this bundle, at the repo root) now keeps only the
Handoff section and a link back to this index.

| # | Title | Status |
| --- | --- | --- |
| [AD-001](/decisions/ad-001.md) | Optional parent-Fast sticky deny for Task spawns | active |
| [AD-002](/decisions/ad-002.md) | Provider-neutral naming and layout | active |
| [AD-003](/decisions/ad-003.md) | No backward compatibility | active |
| [AD-004](/decisions/ad-004.md) | Ports and adapters with an anti-corruption layer per provider | active |
| [AD-005](/decisions/ad-005.md) | Local test runner is the gate; CI matrix runs on every push | active |
| [AD-006](/decisions/ad-006.md) | Windows is covered by CI, minus the installer and the editor end | active |
| [AD-007](/decisions/ad-007.md) | Vendor check applies to core tests; absence checks do not | active |
| [AD-008](/decisions/ad-008.md) | Biome + TypeScript in the gate; `@types/node` pinned to the declared floor | active |
| [AD-009](/decisions/ad-009.md) | Event kinds are provider-agnostic; capabilities are data, not flags | active |
| [AD-010](/decisions/ad-010.md) | Shared vocabulary moves to `src/contracts/` | active |
| [AD-011](/decisions/ad-011.md) | Vendor-specific data belongs to the provider, not to core | active |
| [AD-012](/decisions/ad-012.md) | Prefer Bun at runtime, keep `dist/` for the Node fallback, ship no binary | active |
| [AD-013](/decisions/ad-013.md) | Documentation follows the Open Knowledge Format (OKF v0.1) | active |
| [AD-014](/decisions/ad-014.md) | Claude Code hook payload field paths, pinned | active |
| [AD-015](/decisions/ad-015.md) | Wiring handler names are the entrypoint filenames | active |
| [AD-016](/decisions/ad-016.md) | Field semantics, state writers, and the core export surface | active |
| [AD-017](/decisions/ad-017.md) | The docs gate delegates to the project's tool, and the catalog is the only source of capability metadata | active |
| [AD-018](/decisions/ad-018.md) | Three rails adopted from an external review, each off by default and declared rather than inferred | active |
| [AD-019](/decisions/ad-019.md) | A resource is identified by what it resolves to, and a declared capability must be read where it matters | active |
| [AD-020](/decisions/ad-020.md) | One resolution for the install path, one source for posture, and a config that only advertises what it reads | active |
| [AD-021](/decisions/ad-021.md) | A gate command that never resolved is a config fault, and a recipe runner does not receive file arguments | active |

Related: [/architecture.md](/architecture.md), [/concepts.md](/concepts.md), [/providers/index.md](/providers/index.md).
