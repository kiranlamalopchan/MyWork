/**
 * The last person the server said we were, kept on the phone so that an
 * app opened with no signal still opens as them rather than at the sign-in
 * screen. Only the token decides whether they are signed in; this is only
 * what to draw until the server can be asked again. Nothing on the web.
 */
import { Platform } from "react-native";

import type { Me } from "@/api/types";
import { nativeOrNull } from "@/ui/native";

type FS = typeof import("expo-file-system");
const fs = () => (Platform.OS === "web" ? null : nativeOrNull(() => require("expo-file-system") as FS));

function file() {
  const FS = fs();
  if (!FS) return null;
  return new FS.File(FS.Paths.document, "last-me.json");
}

export async function loadLastMe(): Promise<Me | null> {
  try {
    const f = file();
    if (!f || !f.exists) return null;
    const me = JSON.parse(await f.text());
    return me && typeof me.username === "string" ? (me as Me) : null;
  } catch {
    return null;
  }
}

export function saveLastMe(me: Me | null): void {
  try {
    const f = file();
    if (!f) return;
    if (me) f.write(JSON.stringify(me));
    else if (f.exists) f.delete();
  } catch {
    /* a phone that won't write still works for this session */
  }
}
