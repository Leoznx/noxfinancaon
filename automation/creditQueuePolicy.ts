export type ProviderSubmissionState =
  "not_submitted" | "submitting" | "submitted" | "confirmed" | "unknown";

export type FailureDisposition = "queued" | "technical_failure" | "requires_verification";

/** Mirrors fail_credit_simulation so failure-injection tests can cover the policy. */
export function decideFailureDisposition(input: {
  providerSubmissionState: ProviderSubmissionState;
  retryable: boolean;
  attemptCount: number;
  maxAttempts: number;
}): FailureDisposition {
  if (input.providerSubmissionState !== "not_submitted") return "requires_verification";
  if (input.retryable && input.attemptCount < input.maxAttempts) return "queued";
  return "technical_failure";
}

export function mayPersistLeaseResult(input: {
  expectedWorkerId: string;
  expectedLeaseToken: string;
  expectedExecutionVersion: number;
  workerId: string;
  leaseToken: string;
  executionVersion: number;
}): boolean {
  return (
    input.workerId === input.expectedWorkerId &&
    input.leaseToken === input.expectedLeaseToken &&
    input.executionVersion === input.expectedExecutionVersion
  );
}

export function retryDelayMs(attemptCount: number, baseMs: number, jitterRatio = 0): number {
  const exponential = Math.min(600_000, baseMs * 2 ** Math.max(0, attemptCount - 1));
  return Math.round(exponential + exponential * Math.max(0, jitterRatio));
}
