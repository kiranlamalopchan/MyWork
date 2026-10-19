import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "@/auth/session";
import { Card, Page, Screen } from "@/ui";
import { confirm, notify } from "@/ui/confirm";
import { ActivityPanel, StatementPanel } from "@/ui/ProfilePanels";
import { FriendsPanel } from "@/ui/FriendsPanel";
import { ProfilePhoto } from "@/ui/ProfilePhoto";
import { ProfileRow } from "@/ui/ProfileRow";
import { Version } from "@/ui/Version";
import { alpha, useTheme } from "@/ui/theme";

export default function Profile({ tabMode = false }: { tabMode?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const { me, setMe, signOut } = useSession();
  const [open, setOpen] = useState<"friends" | "statement" | "activity" | null>(null);
  const fold = (key: NonNullable<typeof open>) => ({ minimal: true, open: open === key, onToggle: () => setOpen(v => v === key ? null : key) });
  const leave = () => confirm("Sign out?", undefined, "Sign out", () => {
    void Promise.resolve().then(signOut).catch(error => notify("Couldn't sign out", error?.message || "Please try again."));
  });
  if (!me) return null;
  return <Screen back={!tabMode} backLabel="Home" section="Profile">
    <Page>
      <Card pad={false} style={styles.surface}>
        <View style={styles.hero}>
          <ProfilePhoto me={me} onChange={setMe} />
          <Text accessibilityRole="header" style={[styles.name, { color: t.text }]}>{me.name}</Text>
          <Text style={[styles.handle, { color: t.muted }]}>@{me.username}{me.is_staff ? " · Admin" : ""}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => router.push("/profile/edit")} testID="profile-edit"
            style={({ pressed }) => [styles.edit, { backgroundColor: alpha(t.brand, pressed ? .14 : .07) }]}>
            <Text style={{ color: t.brand, fontSize: 13, fontWeight: "600" }}>Edit profile</Text>
            <Ionicons name="arrow-forward" size={14} color={t.brand} />
          </Pressable>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg height={30} width="100%" viewBox="0 0 400 64" preserveAspectRatio="none">
            <Path d="M0 0 Q200 108 400 0 L400 20 Q200 100 0 20 Z" fill={t.violet} opacity={t.dark ? .23 : .2} />
            <Path d="M0 8 Q200 120 400 8 L400 16 Q200 102 0 16 Z" fill={t.pink} opacity={.22} />
          </Svg>
        </View>
        <View style={styles.menu}>
          <Text style={[styles.label, { color: t.muted }]}>YOUR SPACE</Text>
          <FriendsPanel {...fold("friends")} />
          <StatementPanel {...fold("statement")} />
          <ActivityPanel {...fold("activity")} last />
          <View style={[styles.divider, { backgroundColor: t.line }]} />
          <ProfileRow icon="settings-outline" title="Settings" description="Appearance, privacy & account" onPress={() => router.push("/profile/settings")} testID="profile-settings" />
        </View>
      </Card>
      <ProfileRow icon="log-out-outline" title="Sign out" centred onPress={leave} testID="sign-out" />
      <Text style={[styles.since, { color: t.muted }]}>Member since {me.since}</Text>
      <Version />
    </Page>
  </Screen>;
}
const styles = StyleSheet.create({
  surface: { borderWidth: 0, overflow: "hidden" },
  hero: { alignItems: "center", paddingTop: 24, paddingHorizontal: 24, paddingBottom: 18, gap: 5 },
  name: { fontSize: 24, fontWeight: "600", letterSpacing: -.65, textAlign: "center", marginTop: 8, alignSelf: "stretch" },
  handle: { fontSize: 13, lineHeight: 19, textAlign: "center", alignSelf: "stretch" },
  edit: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 22, marginTop: 10 },
  menu: { paddingTop: 18, paddingBottom: 8 },
  label: { fontSize: 10, fontWeight: "600", letterSpacing: 1.4, paddingHorizontal: 22, paddingBottom: 6 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 22, marginTop: 8, marginBottom: 4 },
  since: { fontSize: 12, textAlign: "center", marginTop: -8 },
});
