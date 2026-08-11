type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

function safeScalar(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function scrubMessage(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "Unexpected internal error";

  return value
    .replace(/\s+params:\s*[\s\S]*$/i, "")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:access_)?token=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:EAA|AQ)[A-Za-z0-9_-]{40,}\b/g, "[REDACTED]")
    .trim();
}

function stackFrames(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;

  const frames = value
    .split("\n")
    .slice(1)
    .filter((line) => /^\s*at\s/.test(line))
    .slice(0, 20);

  return frames.length > 0 ? frames : undefined;
}

export type SafeErrorLog = {
  type: string;
  code?: string | number;
  message: string;
  stack?: string[];
};

export function serializeErrorForLog(value: unknown): SafeErrorLog {
  const error = asRecord(value);
  const cause = asRecord(error?.cause);
  const preferred = cause ?? error;

  const type =
    (typeof error?.name === "string" && error.name) ||
    (value instanceof Error && value.constructor.name) ||
    "UnknownError";
  const code = safeScalar(preferred?.code) ?? safeScalar(error?.code);
  const message = scrubMessage(preferred?.message ?? error?.message);
  const stack = stackFrames(error?.stack);

  return {
    type,
    ...(code !== undefined ? { code } : {}),
    message,
    ...(stack ? { stack } : {}),
  };
}
