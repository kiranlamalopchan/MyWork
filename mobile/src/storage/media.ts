/** Keep draft attachments outside the OS's disposable image-picker cache. */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { randomUUID } from "expo-crypto";
import type { ImagePickerAsset } from "expo-image-picker";
export async function keepDraftMedia(asset: ImagePickerAsset): Promise<ImagePickerAsset> {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) return asset;
  const directory = `${FileSystem.documentDirectory}draft-media/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = (asset.fileName || asset.uri).match(/\.([a-z0-9]{1,5})(?:\?.*)?$/i)?.[1] || (asset.type === "video" ? "mp4" : "jpg");
  const uri = `${directory}${randomUUID()}.${extension}`;
  await FileSystem.copyAsync({ from: asset.uri, to: uri });
  return { ...asset, uri };
}
export async function removeDraftMedia(asset: ImagePickerAsset | null) {
  const directory = FileSystem.documentDirectory && `${FileSystem.documentDirectory}draft-media/`;
  if (directory && asset?.uri.startsWith(directory)) await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
}
