export type NextDelayOptions = {
  attempt: number;
  baseMs: number;
  capMs: number;
  random?: () => number;
};

export function nextDelay(options: NextDelayOptions): number {
  const { attempt, baseMs, capMs, random = Math.random } = options;
  const uncapped = baseMs * 2 ** attempt;
  const ceiling = Math.min(capMs, uncapped);
  return random() * ceiling;
}

export type RetryOptions = {
  attempts: number;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  baseMs?: number;
  capMs?: number;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(fn: () => Promise<T> | T, options: RetryOptions): Promise<T> {
  const {
    attempts,
    shouldRetry = () => true,
    sleep = defaultSleep,
    random = Math.random,
    baseMs = 50,
    capMs = 2000,
  } = options;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === attempts - 1 || !shouldRetry(error)) {
        throw error;
      }
      await sleep(nextDelay({ attempt, baseMs, capMs, random }));
    }
  }
  throw new Error("retry: unreachable");
}
