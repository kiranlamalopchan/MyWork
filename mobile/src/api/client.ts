/**
 * How the app talks to Django: /api/v1/, a token in the header, the
 * phone's time zone alongside, JSON in and out — and a multipart post for
 * anything with a file in it.
 */
import { getToken, signOutEverywhere } from "@/auth/token";

const BASE = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

export const apiUrl = (path: string) => `${BASE}/api/v1/${path.replace(/^\/+/, "")}`;
export const siteUrl = (path: string) => `${BASE}${path.startsWith("/") ? path : `/${path}`}`;

export class ApiError extends Error {
  status: number;
  fields: Record<string, string[]>;
  constructor(status: number, detail: string, fields: Record<string, string[]> = {}) {
    super(detail);
    this.status = status;
    this.fields = fields;
  }
}

function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  /** Send without a token — signing in and up. */
  anonymous?: boolean;
};

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const url = new URL(apiUrl(path));
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  const tz = timezone();
  if (tz) headers["X-Timezone"] = tz;
  if (!options.anonymous) {
    const token = await getToken();
    // Signed out: nothing to ask with. A screen that renders for a frame
    // before the sign-in guard has run shouldn't cost a request.
    if (!token) throw new ApiError(401, "Sign in first.");
    headers.Authorization = `Token ${token}`;
  }
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), { method: options.method || "GET", headers, body });
  } catch (error) {
    throw new ApiError(0, "It couldn't be sent. Check the connection and try again.");
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (response.status === 401 && !options.anonymous) await signOutEverywhere();
    const detail =
      (data && (data.detail || data.error)) ||
      (response.status >= 500
        ? `The server hit an error (HTTP ${response.status}).`
        : `That couldn't be done (HTTP ${response.status}).`);
    throw new ApiError(response.status, String(detail), (data && data.fields) || {});
  }
  return data as T;
}

/** A file the way React Native's FormData wants it: a uri, a name and a type. */
export type FilePart = { uri: string; name: string; type: string };

export function formWith(fields: Record<string, string | number | FilePart | undefined | null>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") form.append(key, value as unknown as Blob);
    else form.append(key, String(value));
  }
  return form;
}
