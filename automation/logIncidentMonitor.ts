import { createStableSystemCorrelationId, isValidCorrelationId } from "./correlation";

export interface MonitoredLogIncident {
  correlationId: string;
  message: string;
}

const knownHandledEvents = new Set([
  "automation_error_recorded",
  "repair_job_finished",
  "supervisor_credit_exited",
  "supervisor_credit_started",
  "supervisor_repair_exited",
  "supervisor_repair_started",
]);

const errorPattern =
  /\b(?:erro|error|fatal|failed|failure|falha|falhou|falhado|falhada|uncaught|unhandled|crash(?:ed)?)\b/i;
const correlationPattern = /\bNOX-(?:SIM|SYS)-\d{8}-[A-F0-9]{8}\b/i;

export function analyzeWorkerLogLine(line: string, date = new Date()): MonitoredLogIncident | null {
  const message = line.trim();
  if (!message || /\b(?:0|zero)\s+(?:errors?|erros?|failures?|falhas?)\b/i.test(message))
    return null;

  try {
    const structured = JSON.parse(message) as Record<string, unknown>;
    const event = typeof structured.event === "string" ? structured.event : "";
    if (knownHandledEvents.has(event)) return null;
    const level = String(structured.level ?? structured.severity ?? structured.status ?? "");
    if (!errorPattern.test(event) && !errorPattern.test(level) && !structured.error) return null;
  } catch {
    if (!errorPattern.test(message)) return null;
  }

  const extracted = message.match(correlationPattern)?.[0]?.toUpperCase();
  return {
    correlationId:
      extracted && isValidCorrelationId(extracted)
        ? extracted
        : createStableSystemCorrelationId(message.toLowerCase().replace(/\d+/g, "#"), date),
    message,
  };
}
