import React, { useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { me as api, type Me } from "@/api";
import type { FilePart } from "@/api/client";
import { ActionMenu } from "./ActionMenu";
import { Avatar } from "./Avatar";
import { confirm, notify } from "./confirm";
import { useTheme } from "./theme";

export function ProfilePhoto({ me, onChange }: { me: Me; onChange: (me: Me) => void }) {
  const t = useTheme();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await work(); }
    catch (error: any) { notify("Couldn't update your photo", error?.message || "Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const pick = () => run(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: .9 });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) throw new Error("No photo was selected. Please choose another image.");
    const name = asset.fileName || "photo.jpg", type = asset.mimeType || "image/jpeg";
    const file: FilePart = { uri: asset.uri, name, type };
    onChange(await api.setPhoto(file));
  });
  const remove = () => confirm("Remove your photo?", "Your initial goes back in its place.", "Remove", () => {
    void run(async () => onChange(await api.clearPhoto()));
  });
  return <View style={styles.wrap}>
    <ActionMenu label={busy ? "Updating your photo" : "Profile photo actions"} disabled={busy}
      trigger={<View>
        <Avatar person={me} size={80} live={false} />
        <View style={[styles.badge, { backgroundColor: t.surface, borderColor: t.line }]}>
          <Ionicons name="camera-outline" size={14} color={t.text2} />
        </View>
      </View>}
      triggerStyle={styles.trigger}
      actions={[
        { label: me.photo ? "Change photo" : "Add photo", icon: "image-outline", onPress: () => { void pick(); } },
        ...(me.photo ? [{ label: "Remove photo", icon: "trash-outline" as const, destructive: true, onPress: remove }] : []),
      ]} />
    {busy ? <View pointerEvents="none" style={[styles.loading, { backgroundColor: t.surface }]}><ActivityIndicator color={t.brand} accessibilityLabel="Updating your photo" /></View> : null}
  </View>;
}
const styles = StyleSheet.create({
  wrap: { width: 88, height: 88, alignItems: "center", justifyContent: "center" },
  trigger: { width: 88, height: 88, borderRadius: 44 },
  badge: { position: "absolute", right: -2, bottom: -1, width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  loading: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: 44, opacity: .9, alignItems: "center", justifyContent: "center" },
});
