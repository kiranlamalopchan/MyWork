/**
 * How the app talks to Django: /api/v1/, a token in the header, the
 * phone's time zone alongside, JSON in and out — and a multipart post for
 * anything with a file in it.
 */
import { getToken, signOutEverywhere } from "@/auth/token";

import { serverUrl } from "./server";

export const apiUrl = (path: string) => `${serverUrl()}/api/v1/${path.replace(/^\/+/, "")}`;
export const siteUrl = (path: string) => `${serverUrl()}${path.startsWith("/") ? path : `/${path}`}`;

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
  /** For a multipart post: how much of it has gone, 0–1. */
  onProgress?: (sent: number) => void;
};

// A file upload waits this long for the server's answer: a video is
// converted before it is answered, which can take a minute or more.
// (fetch's own limit on iOS is a minute, which is exactly too short.)
const UPLOAD_TIMEOUT = 10 * 60_000;
// A plain request gives up after this: fetch on Android would otherwise
// wait forever on a connection that has quietly died. Long enough for a
// sleeping host to wake up and answer — the first request after a quiet
// spell is the slow one, and cutting it off looks like no connection at all.
const REQUEST_TIMEOUT = 45_000;

type Reply = { status: number; ok: boolean; text: string; contentType: string };

/** One request, as fetch or — with a form to send — as XMLHttpRequest, which reports progress and takes a longer timeout. */
function send(url: string, method: string, headers: Record<string, string>, body: BodyInit | undefined, form: boolean, onProgress?: (sent: number) => void): Promise<Reply> {
  if (!form) {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT);
    return fetch(url, { method, headers, body, signal: ctl.signal })
      .then(async (r) => ({ status: r.status, ok: r.ok, text: r.status === 204 ? "" : await r.text(), contentType: r.headers?.get?.("content-type") || "" }))
      // Our own timeout, however the platform reports it: iOS raises a
      // native cancellation of its own rather than an `AbortError`, so the
      // signal is what we trust, not the error's name.
      .catch((e) => { throw ctl.signal.aborted ? new Error("The server took too long to answer") : e; })
      .finally(() => clearTimeout(id));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.timeout = UPLOAD_TIMEOUT;
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    if (onProgress && xhr.upload) xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress(e.loaded / e.total); };
    xhr.onload = () => resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, text: xhr.responseText || "", contentType: xhr.getResponseHeader("content-type") || "" });
    xhr.onerror = () => reject(new Error("Network request failed"));
    xhr.ontimeout = () => reject(new Error("The server took too long to answer"));
    xhr.onabort = () => reject(new Error("The upload was cancelled"));
    xhr.send(body as XMLHttpRequestBodyInit);
  });
}

/**
 * The half-sentence in brackets after "couldn't reach", or nothing. The
 * native side says things like "FetchRequestCanceledException: … (at
 * ExpoURLSessionTask.swift:56)" — a Swift file and a line number tell the
 * person holding the phone nothing, and reading one is alarming — so only
 * a short, plain sentence of our own is passed on; anything else is
 * dropped and the advice that follows stands on its own.
 */
function reason(error: any): string {
  const raw = String(error?.message || "").trim();
  if (!raw) return "";
  if (/^network request failed$/i.test(raw)) return "";
  if (/\.(swift|kt|java|mm?|cpp|c):\d+|exception|\bat .+:\d+|\bnserror|domain=/i.test(raw)) return "";
  if (raw.length > 60) return "";
  return raw.toLowerCase();
}

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

  let response: Reply;
  try {
    response = await send(url.toString(), options.method || "GET", headers, body, !!options.form, options.onProgress);
  } catch (error: any) {
    const why = reason(error);
    throw new ApiError(0, `Couldn't reach ${serverUrl()}${why ? ` (${why.toLowerCase()})` : ""}. Check the connection — or the server address on the sign-in screen.`);
  }

  if (response.status === 204) return undefined as T;
  const text = response.text;
  let data: any = null;
  let parsed = false;
  try {
    if (text) { data = JSON.parse(text); parsed = true; }
  } catch {
    data = null;
  }
  // An answer that isn't JSON — a site without the API on it, an old
  // deploy, a wrong address, a captive Wi-Fi page — is not something a
  // screen can use, whatever its status says.
  const type = response.contentType;
  if (!parsed && !/json/i.test(type) && (response.ok || response.status === 404)) {
    throw new ApiError(response.status, `${serverUrl()} doesn't have the KaamKoRecord app API. Update the site there, or change the server address on the sign-in screen.`);
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
