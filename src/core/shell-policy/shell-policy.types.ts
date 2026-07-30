export type ShellEffectClass = "read" | "write" | "network" | "destructive";

export type ShellStallEntry = {
  lastCommand?: string;
  hits: number;
};

export type ShellStallStore = Record<string, ShellStallEntry>;
