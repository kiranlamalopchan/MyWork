import { Platform } from "react-native";
import { tr } from "@/i18n";

type Failure = { status?: number; name?: string; message?: string; stack?: string; request?: { method: string; path: string; id?: string } };
const SECRET = /token|secret|password|authorization|cookie|api.?key|csrf|session/i;

export function redact(value: unknown): unknown {
  if (typeof value === "string") return value
    .replace(/\b(?:Bearer|Token)\s+[^\s"']+/gi, "[redacted]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[redacted]")
    .replace(/\b(?:sk_|pk\.)[\w.-]+/g, "[redacted]")
    .replace(/([?&](?:access_token|key)=)[^&\s]+/gi, "$1[redacted]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET.test(key) ? "[redacted]" : redact(item)]));
  return value;
}

/** Machine faults always get fixed copy. Only our API's written validation passes through. */
export function describeError(error: unknown) {
  const e = (error && typeof error === "object" ? error : {}) as Failure;
  const status = e.status;
  const kind = status === 0 ? "network" : status === 401 || status === 403 ? "auth" : status && status >= 500 ? "server" : status === 400 || status === 409 ? "validation" : "app";
  let message = "Something went wrong. Please try again.";
  if (kind === "network") message = "We couldn't connect. Check your internet and try again.";
  else if (kind === "server") message = "Something went wrong on our side. Please try again.";
  else if (status === 401) message = "Please sign in again to continue.";
  else if (status === 403) message = "You don't have access to that.";
  else if (status === 404) message = "We couldn't find that. It may have been removed.";
  else if (status === 429) message = "Too many tries. Wait a minute, then try again.";
  else if (kind === "validation" && e.message && !/Traceback|Exception|\bat .+:\d+|HTTP \d|[<>]/.test(e.message)) message = e.message;
  return {
    message: tr(message),
    report: redact({ kind, name: e.name || "Error", status, request: e.request ? { ...e.request, path: e.request.path.split("?")[0] } : undefined,
      // Validation messages can contain people's messages or payslip data.
      message: kind === "validation" ? "Request validation failed" : e.message || "Unknown failure",
      stack: e.stack?.split("\n").slice(0, 8).join("\n"), at: new Date().toISOString(), app: "KaamKoRecord", platform: Platform.OS }) as Record<string, unknown>,
  };
}

const logged = new WeakSet<object>();
const described = new WeakMap<object, ReturnType<typeof describeError>>();
export function logError(report: Record<string, unknown>): void {
  if (logged.has(report)) return;
  logged.add(report);
  console.warn(JSON.stringify(report));
}

export function errorMessage(error: unknown): string {
  const object = error && typeof error === "object" ? error : null;
  const result = (object && described.get(object)) || describeError(error);
  if (object) described.set(object, result);
  logError(result.report);
  // Re-translate if the person changed language since this error was first logged.
  return describeError(error).message;
}
