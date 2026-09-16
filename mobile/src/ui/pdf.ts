/**
 * A PDF from the API, opened the way the phone opens files: fetched with
 * the token, written to the cache, handed to the share sheet (or, on the
 * web build, a new tab). GET by default; a POST carries `body` as JSON.
 * The native modules are loaded here, not at the top of a screen, so a
 * build made before they were added still shows the screen.
 */
import { Platform } from "react-native";

import { getToken } from "@/auth/token";

import { notify } from "./confirm";
import { native } from "./native";

export async function openPdf(url: string, name: string, body?: unknown): Promise<void> {
  const token = await getToken();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const headers: Record<string, string> = { Authorization: `Token ${token}`, "X-Timezone": tz };
  const init: RequestInit = body === undefined
    ? { headers }
    : { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = `The server said no (HTTP ${response.status}).`;
    try { detail = (await response.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  if (Platform.OS === "web") {
    const href = URL.createObjectURL(await response.blob());
    globalThis.open?.(href, "_blank");
    return;
  }
  const { Directory, File, Paths } = native<typeof import("expo-file-system")>(() => require("expo-file-system"));
  const Sharing = native<typeof import("expo-sharing")>(() => require("expo-sharing"));
  const dir = new Directory(Paths.cache, "pdf");
  if (!dir.exists) dir.create();
  const file = new File(dir, name);
  file.write(new Uint8Array(await response.arrayBuffer()));
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
  else notify("Saved", file.uri);
}
