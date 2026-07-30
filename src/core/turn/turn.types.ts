export type LoopState = {
  session_key: string;
  count: number;
  updated_at: string;
};

export type LoopCheck = {
  count: number;
  capReached: boolean;
};

export type BootResult = {
  alreadyBooted: boolean;
};
