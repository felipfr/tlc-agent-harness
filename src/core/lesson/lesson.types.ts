export type LessonStatus = "candidate" | "active" | "quarantine";

export type LessonSource = "core" | "project" | "manual";

export type HarnessLesson = {
  id: string;
  scope: "gate-execution";
  failedGate: string;
  category: string;
  triggerTokens: string[];
  instruction: string;
  avoid: string;
  prefer: string;
  preRetryCheck: string;
  source: LessonSource;
  status: LessonStatus;
  confidence: number;
  hitCount: number;
  priority: number;
  projectScoped: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  lastAccessedAt: string;
  updatedAt: string;
};

export type LessonStoreFile = {
  version: 1;
  lessons: HarnessLesson[];
};
