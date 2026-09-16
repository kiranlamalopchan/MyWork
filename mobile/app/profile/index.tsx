/**
 * Your profile, to look at (templates/accounts/profile.html): who you are,
 * what MyWork knows about you, and the way to change it. Nothing here is a
 * form — changing your details is a screen you go to on purpose, behind
 * the small Edit beside your name. The picture is the exception: tapping
 * your face offers the only two choices there are.
 */
import React from "react";
import { ActionSheetIOS, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { me as api } from "@/api";
import type { FilePart } from "@/api/client";
import { useSession } from "@/auth/session";
import { Avatar, Button, Card, Page, Screen } from "@/ui";
import { confirm, notify } from "@/ui/confirm";
import { ActivityPanel, StatementPanel } from "@/ui/ProfilePanels";
import { BiometricRow } from "@/ui/BiometricRow";
import { radius, sp, useTheme } from "@/ui/theme";

export default function Profile() {
  const t = useTheme();
  const router = useRouter();
  const { me, setMe, signOut } = useSession();
  if (!me) return null;

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const name = asset.fileName || "photo.jpg", type = asset.mimeType || "image/jpeg";
    try {
      const file: FilePart = Platform.OS === "web"
        ? (new File([await (await fetch(asset.uri)).blob()], name, { type }) as unknown as FilePart)
        : { uri: asset.uri, name, type };
      setMe(await api.setPhoto(file));
    } catch (e: any) {
      notify("Couldn't use that photo", e?.message || "");
    }
  };
  const removePhoto = () => confirm("Remove your photo?", "Your initial goes back in its place.", "Remove", async () => setMe(await api.clearPhoto()));
  const photoMenu = () => {
    if (!me.photo) return pick();
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options: ["Cancel", "Change photo", "Remove photo"], destructiveButtonIndex: 2, cancelButtonIndex: 0 }, (i) => { if (i === 1) pick(); if (i === 2) removePhoto(); });
    } else {
      confirm("Your photo", undefined, "Change photo", pick, false);
    }
  };

  const hasDetails = !!(me.display_name || me.email || me.phone || me.address);
  const facts: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [
    { icon: "person-outline", label: "Name", value: me.display_name },
    { icon: "mail-outline", label: "Email", value: me.email },
    { icon: "call-outline", label: "Phone", value: me.phone },
    { icon: "location-outline", label: "Address", value: me.address },
  ];

  return (
    <Screen back backLabel="Home">
      <Page>
        <Card pad={false} style={styles.id}>
          <View style={[styles.cover, { backgroundColor: `hsl(${me.hue}, 55%, ${t.dark ? 28 : 56}%)` }]} />
          <Pressable onPress={() => router.push("/profile/edit")} style={[styles.edit, { backgroundColor: "rgba(255,255,255,0.22)" }]} testID="profile-edit">
            <Ionicons name="pencil" size={14} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Edit</Text>
          </Pressable>
          <Pressable onPress={photoMenu} accessibilityLabel={me.photo ? "Change or remove your photo" : "Add a photo"} style={[styles.face, { borderColor: t.surface }]}>
            <Avatar person={me} size={96} />
            <View style={[styles.camera, { backgroundColor: t.brand, borderColor: t.surface }]}>
              <Ionicons name="camera" size={15} color={t.brandInk} />
            </View>
          </Pressable>
          <Text style={[styles.name, { color: t.text }]}>{me.name}</Text>
          <Text style={{ color: t.muted, fontSize: 14.5, marginBottom: sp[5] }}>@{me.username} · since {me.since}</Text>
        </Card>

        <Card pad={false}>
          {facts.map((f, i) => (
            <View key={f.label} style={[styles.fact, { borderTopColor: t.line, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
              <Ionicons name={f.icon} size={18} color={t.muted} />
              <Text style={{ color: t.text2, fontSize: 15, flex: 1 }}>{f.label}</Text>
              <Text style={{ color: t.text, fontSize: 15, fontWeight: f.value ? "700" : "400", flexShrink: 1, textAlign: "right" }} numberOfLines={2}>{f.value || "—"}</Text>
            </View>
          ))}
          {!hasDetails ? (
            <Pressable onPress={() => router.push("/profile/edit")} style={[styles.prompt, { borderTopColor: t.line, backgroundColor: t.surface2 }]}>
              <Text style={{ color: t.brand, fontWeight: "700", fontSize: 15 }}>Add your contact details</Text>
              <Ionicons name="chevron-forward" size={16} color={t.brand} />
            </Pressable>
          ) : null}
        </Card>

        <StatementPanel />
        <ActivityPanel />
        <BiometricRow username={me.username} />
        <Button title="Sign out" kind="danger" onPress={() => confirm("Sign out?", undefined, "Sign out", signOut)} testID="sign-out" />
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  id: { alignItems: "center", gap: sp[1], overflow: "hidden" },
  cover: { width: "100%", height: 96 },
  edit: { position: "absolute", top: sp[3], right: sp[3], flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 999 },
  face: { marginTop: -48, borderWidth: 4, borderRadius: 56 },
  camera: { position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginTop: sp[2] },
  fact: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], minHeight: 56 },
  prompt: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: sp[3], borderTopWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
});
