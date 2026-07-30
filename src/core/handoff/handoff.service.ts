import { patchHandoff, readHandoffFile } from "./handoff.store.ts";
import type { ForeignSlice, HandoffProviderSlice, HandoffShared } from "./handoff.types.ts";

export type ResolvedHandoff = HandoffShared & HandoffProviderSlice;

export function readHandoff(root: string, provider: string): ResolvedHandoff {
  const file = readHandoffFile(root);
  const slice = file.by_provider[provider] ?? { updated_at: file.shared.updated_at };
  return { ...file.shared, ...slice };
}

export function readForeignSlices(root: string, provider: string): ForeignSlice[] {
  const file = readHandoffFile(root);
  const foreign: ForeignSlice[] = [];
  for (const [name, slice] of Object.entries(file.by_provider)) {
    if (name === provider) {
      continue;
    }
    if (slice.next_action === undefined && slice.blockers === undefined) {
      continue;
    }
    foreign.push({ provider: name, next_action: slice.next_action, blockers: slice.blockers });
  }
  return foreign;
}

export { patchHandoff, readHandoffFile };
