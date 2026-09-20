/**
 * A big video, sent a piece at a time.
 *
 * The site's host refuses any request over 100 MB before Django sees it
 * (a 413), and a minute of phone video is often two or three times that.
 * So past a threshold the app reads the file in slices — base64, which a
 * phone can do without loading the whole file — posts each slice to
 * `uploads/`, and then makes the story by naming the assembled upload
 * instead of attaching the file. Small videos still go in one request.
 *
 * Native only: the web build gets its files as Blobs, which the browser
 * can send whole, and it does not talk to the host with the limit.
 */
import { Platform } from "react-native";

import { api, type FilePart } from "./client";

/** Files over this go in pieces. Well under the host's limit, with room for the multipart overhead. */
export const CHUNK_AT = 60 * 1024 * 1024;
/** Raw bytes per piece; base64 makes each request about a third bigger. */
const PIECE = 6 * 1024 * 1024;

type Legacy = typeof import("expo-file-system/legacy");
const fs = (): Legacy | null => {
  if (Platform.OS === "web") return null;
  try {
    return require("expo-file-system/legacy") as Legacy;
  } catch {
    return null;
  }
};

/** How big the file behind `part` is, or null where that can't be asked (the web, a build without the module). */
export async function sizeOf(part: FilePart): Promise<number | null> {
  const FS = fs();
  if (!FS) return null;
  try {
    const info = await FS.getInfoAsync(part.uri);
    return info.exists && typeof info.size === "number" ? info.size : null;
  } catch {
    return null;
  }
}

function newId(): string {
  let id = "";
  for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

/**
 * Send `part` in pieces. Resolves to the upload id the story request
 * names. `onProgress` is 0→1 across the whole file.
 */
export async function uploadInPieces(part: FilePart, size: number, onProgress?: (sent: number) => void): Promise<string> {
  const FS = fs();
  if (!FS) throw new Error("This build can't send a video that large.");
  const uploadId = newId();
  const total = Math.max(1, Math.ceil(size / PIECE));
  for (let index = 0; index < total; index++) {
    const position = index * PIECE;
    const data = await FS.readAsStringAsync(part.uri, { encoding: FS.EncodingType.Base64, position, length: Math.min(PIECE, size - position) });
    await api("uploads/", { method: "POST", body: { upload_id: uploadId, index, total, data } });
    onProgress?.((index + 1) / total);
  }
  return uploadId;
}
