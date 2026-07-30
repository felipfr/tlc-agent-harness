export type PlanDeclaration = {
  paths: string[];
  snippet: string;
};

export type PlanDeviation = {
  path: string;
  reason: string;
};

export type PlanState = {
  paths: string[];
  declaredAt: string;
  deviations: PlanDeviation[];
};

export type PlanPolicyConfig = {
  enabled: boolean;
  windowMinutes: number;
};

export type PlanVerdict = {
  active: boolean;
  unplanned: string[];
};
