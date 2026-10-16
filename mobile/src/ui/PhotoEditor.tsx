/** A local crop and quarter-turn editor. The original photo is never changed. */
import React, { useState } from "react";
import { Image, Text, View } from "react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Button, Card } from "./index";
import { sp, useTheme } from "./theme";

import { cropRectangle, type CropEdges } from "./photo-crop";
export function PhotoEditor({ asset, onDone, onCancel }: { asset: ImagePickerAsset; onDone: (asset: ImagePickerAsset) => void; onCancel: () => void }) {
  const t = useTheme();
  const [photo, setPhoto] = useState(asset);
  const [edges, setEdges] = useState<CropEdges>({ left: 0, top: 0, right: 0, bottom: 0 });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [width, setWidth] = useState(300);
  const shownHeight = Math.min(400, width * photo.height / photo.width);
  const shownWidth = Math.min(width, shownHeight * photo.width / photo.height);
  const adjust = (side: keyof CropEdges, delta: number) => setEdges(previous => {
    const other = side === "left" ? "right" : side === "right" ? "left" : side === "top" ? "bottom" : "top";
    return { ...previous, [side]: Math.max(0, Math.min(.85 - previous[other], Math.round((previous[side] + delta) * 100) / 100)) };
  });
  const edit = async (rotate: boolean) => {
    setBusy(true); setError("");
    try {
      const context = ImageManipulator.manipulate(photo.uri);
      if (rotate) context.rotate(90);
      else context.crop(cropRectangle(photo.width, photo.height, edges));
      const image = await context.renderAsync();
      const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: .95 });
      const next = { ...photo, ...result, fileName: "picking-slip.jpg", mimeType: "image/jpeg" };
      if (rotate) { setPhoto(next); setEdges({ left: 0, top: 0, right: 0, bottom: 0 }); }
      else onDone(next);
    } catch { setError("That photo couldn't be edited. Try choosing it again."); }
    finally { setBusy(false); }
  };
  return <Card style={{ gap: sp[3] }}>
    <Text style={{ color: t.text, fontSize: 20, fontWeight: "700" }}>Prepare your picking slip</Text>
    <Text style={{ color: t.muted }}>Rotate upright, then trim away headers or background text. Only the area inside the outline will be read.</Text>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ alignItems: "center" }}>
      <View style={{ width: shownWidth, height: shownHeight }}>
        <Image source={{ uri: photo.uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
        <View pointerEvents="none" style={{ position: "absolute", left: edges.left * shownWidth, top: edges.top * shownHeight, right: edges.right * shownWidth, bottom: edges.bottom * shownHeight, borderWidth: 3, borderColor: t.brand }} />
      </View>
    </View>
    {(["top", "bottom", "left", "right"] as const).map(side => <View key={side} style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
      <Text style={{ color: t.text, flex: 1, textTransform: "capitalize" }}>{side}: {Math.round(edges[side] * 100)}%</Text>
      <Button title="−" accessibilityLabel={`Restore ${side} edge`} size="sm" kind="plain" disabled={busy} onPress={() => adjust(side, -.05)} />
      <Button title="+" accessibilityLabel={`Trim ${side} edge`} size="sm" kind="plain" disabled={busy} onPress={() => adjust(side, .05)} />
    </View>)}
    {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
    <Button title="Rotate 90°" icon="refresh" kind="plain" disabled={busy} onPress={() => edit(true)} />
    <Button title="Read selected area" icon="scan" busy={busy} testID="photo-read-selected" onPress={() => edit(false)} />
    <Button title="Cancel" kind="ghost" disabled={busy} onPress={onCancel} />
  </Card>;
}
