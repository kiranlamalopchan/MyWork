/**
 * Your profile, to look at (templates/accounts/profile.html): who you are,
 * what MyWork knows about you, and the way to change it. Nothing here is a
 * form — changing your details is a screen you go to on purpose, behind
 * the Edit button under your name. The picture is the exception: tapping
 * your face offers the only two choices there are.
 *
 * Laid out the Material way: a tonal header with your face and name, then
 * lists on solid surfaces — your contact details, and the three things
 * that unfold (friends, a statement, your activity) as one list.
 */
import React, { useState } from "react";
import { ActionSheetIOS, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { me as api } from "@/api";
import type { FilePart } from "@/api/client";
import { useSession } from "@/auth/session";
import { Avatar, Button, Card, MenuRow, Page, Screen } from "@/ui";
import { confirm, notify } from "@/ui/confirm";
import { ActivityPanel, StatementPanel } from "@/ui/ProfilePanels";
import { BiometricRow } from "@/ui/BiometricRow";
import { PushRow } from "@/ui/PushRow";
import { FriendsPanel } from "@/ui/FriendsPanel";
import { siteUrl } from "@/api/client";
import { openBrowserAsync } from "expo-web-browser";
import { alpha, mix, radius, sp, useTheme } from "@/ui/theme";

export default function Profile() {
  const t = useTheme();
  const router = useRouter();
  const { me, setMe, signOut } = useSession();
  // One fold open at a time: opening another puts the first away.
  const [open, setOpen] = useState<"friends" | "statement" | "activity" | null>(null);
  const fold = (key: typeof open) => ({ open: open === key, onToggle: () => setOpen((v) => (v === key ? null : key)) });
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
  // The header is painted in a tonal wash of the brand, the way a Material
  // primary container is: a colour of its own, not a tint over the page.
  const tonal = mix(t.brand, t.surface, t.dark ? 0.16 : 0.1);

  return (
    <Screen back backLabel="Home">
      <Page>
        <Card pad={false} style={[styles.hero, { backgroundColor: tonal, borderColor: "transparent" }]}>
          <Pressable onPress={photoMenu} accessibilityLabel={me.photo ? "Change or remove your photo" : "Add a photo"} style={styles.face}>
            <View style={[styles.ring, { borderColor: t.surface }]}>
              <Avatar person={me} size={104} live={false} />
            </View>
            <View style={[styles.camera, { backgroundColor: t.brand, borderColor: tonal }]}>
              <Ionicons name="camera" size={17} color={t.brandInk} />
            </View>
          </Pressable>
          <Text style={[styles.name, { color: t.text }]}>{me.name}</Text>
          <Text style={[styles.handle, { color: t.text2 }]}>@{me.username}</Text>
          <View style={styles.tags}>
            <Tag icon="calendar-outline" label={`Since ${me.since}`} />
            {me.is_staff ? <Tag icon="shield-checkmark-outline" label="Admin" /> : null}
          </View>
          <Button title="Edit profile" icon="pencil-outline" kind="plain" size="sm" onPress={() => router.push("/profile/edit")} style={{ ...styles.edit, backgroundColor: t.surface }} testID="profile-edit" />
        </Card>

        <Card pad={false}>
          <Text style={[styles.heading, { color: t.muted }]}>Contact</Text>
          {facts.map((f, i) => (
            <View key={f.label} style={[styles.fact, { borderTopColor: t.line, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
              <Ionicons name={f.icon} size={22} color={f.value ? t.brand : t.muted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.factLabel, { color: t.muted }]}>{f.label}</Text>
                <Text style={[styles.factValue, { color: f.value ? t.text : t.muted }]} numberOfLines={2}>{f.value || "Not set"}</Text>
              </View>
            </View>
          ))}
          {!hasDetails ? (
            <Pressable onPress={() => router.push("/profile/edit")} style={({ pressed }) => [styles.prompt, { borderTopColor: t.line, backgroundColor: pressed ? alpha(t.brand, 0.08) : "transparent" }]}>
              <Text style={{ color: t.brand, fontWeight: "600", fontSize: 15 }}>Add your contact details</Text>
              <Ionicons name="arrow-forward" size={18} color={t.brand} />
            </Pressable>
          ) : null}
        </Card>

        <Card pad={false}>
          <FriendsPanel {...fold("friends")} />
          <StatementPanel {...fold("statement")} />
          <ActivityPanel {...fold("activity")} last />
        </Card>

        <PushRow />
        <BiometricRow username={me.username} />
        <Card pad={false}>
          <MenuRow icon="ban-outline" title="Blocked people" sub="Who you've chosen not to hear from" onPress={() => router.push("/profile/blocked")} tint={t.danger} last testID="blocked-people" />
        </Card>
        <Button title="Sign out" icon="log-out-outline" kind="danger" onPress={() => confirm("Sign out?", undefined, "Sign out", signOut)} testID="sign-out" />
        <View style={styles.legal}>
          <Pressable onPress={() => openBrowserAsync(siteUrl("/safety/rules/")).catch(() => {})} hitSlop={8}><Text style={[styles.legalLink, { color: t.muted }]}>Rules</Text></Pressable>
          <Text style={{ color: t.muted }}>·</Text>
          <Pressable onPress={() => openBrowserAsync(siteUrl("/privacy/")).catch(() => {})} hitSlop={8}><Text style={[styles.legalLink, { color: t.muted }]}>Privacy</Text></Pressable>
          <Text style={{ color: t.muted }}>·</Text>
          <Pressable onPress={() => router.push("/profile/delete")} hitSlop={8} testID="delete-account"><Text style={[styles.legalLink, { color: t.danger }]}>Delete account</Text></Pressable>
        </View>
      </Page>
    </Screen>
  );
}

/** An assist chip: a small fact about you, the outlined Material kind. */
function Tag({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.tag, { borderColor: alpha(t.brand, 0.35) }]}>
      <Ionicons name={icon} size={15} color={t.brand} />
      <Text style={{ color: t.text, fontSize: 13.5, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingTop: sp[6], paddingBottom: sp[5], paddingHorizontal: sp[5], borderRadius: radius.xl, gap: sp[1] },
  face: { marginBottom: sp[2] },
  ring: { borderWidth: 4, borderRadius: 60, padding: 2 },
  camera: { position: "absolute", right: -2, bottom: -2, width: 36, height: 36, borderRadius: 12, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 26, fontWeight: "700", letterSpacing: -0.6, textAlign: "center" },
  handle: { fontSize: 15, textAlign: "center" },
  tags: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: sp[2], marginTop: sp[2] },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
  edit: { marginTop: sp[4], alignSelf: "center", paddingHorizontal: sp[5] },
  heading: { fontSize: 14, fontWeight: "600", paddingHorizontal: sp[4], paddingTop: sp[4], paddingBottom: sp[1] },
  fact: { flexDirection: "row", alignItems: "center", gap: sp[4], paddingHorizontal: sp[4], paddingVertical: sp[3], minHeight: 64 },
  factLabel: { fontSize: 12.5, fontWeight: "600", letterSpacing: 0.2 },
  factValue: { fontSize: 16, marginTop: 2, letterSpacing: -0.1 },
  legal: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sp[3], paddingVertical: sp[2] },
  legalLink: { fontSize: 13.5, textDecorationLine: "underline" },
  prompt: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sp[2], paddingVertical: sp[4], borderTopWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
});
