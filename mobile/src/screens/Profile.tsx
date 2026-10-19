import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
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
import { useTheme } from "@/ui/theme";
import { useActivity } from "@/api";

export default function Profile({ tabMode = false }: { tabMode?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const { me, setMe, signOut } = useSession();
  const figures = useActivity().data;
  const [open, setOpen] = useState<"friends" | "statement" | "activity" | null>(null);
  const fold = (key: NonNullable<typeof open>) => ({ minimal: true, open: open === key, onToggle: () => setOpen(v => v === key ? null : key) });
  const leave = () => confirm("Sign out?", undefined, "Sign out", () => {
    void Promise.resolve().then(signOut).catch(error => notify("Couldn't sign out", error?.message || "Please try again."));
  });
  if (!me) return null;
  return <Screen back={!tabMode} backLabel="Home" section="Profile">
    <Page>
      <Card pad={false} style={[styles.surface, { borderColor: t.line, borderWidth: StyleSheet.hairlineWidth }, float(t.dark, 1)]}>
        {/* The cover: a neutral panel with two flat hills — no gradient —
            floating inside the card (inset, rounded all round), with Edit
            profile in its corner and your face half over its lower edge. */}
        <View style={[styles.cover, { backgroundColor: t.surface2 }]}>
          <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Svg width="100%" height="100%" viewBox="0 0 400 120" preserveAspectRatio="none">
              <Path d="M0 70 C70 30 130 30 200 62 S330 96 400 48 V120 H0 Z" fill={t.surface3} />
              <Path d="M0 96 C80 64 150 70 220 92 S340 112 400 84 V120 H0 Z" fill={t.lineStrong} />
            </Svg>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => router.push("/profile/edit")} testID="profile-edit"
            style={({ pressed }) => [styles.edit, { backgroundColor: pressed ? t.surface2 : t.surface }, float(t.dark, 2)]}>
            <Ionicons name="pencil-outline" size={14} color={t.text} />
            <Text style={{ color: t.text, fontSize: 13, fontWeight: "600" }}>Edit profile</Text>
          </Pressable>
        </View>
        <View style={styles.hero}>
          <View style={[styles.face, float(t.dark, 2)]}><ProfilePhoto me={me} onChange={setMe} size={92} ring={t.surface} /></View>
          <Text accessibilityRole="header" style={[styles.name, { color: t.text }]}>{me.name}</Text>
          <Text style={[styles.handle, { color: t.muted }]}>@{me.username}{me.is_staff ? " · Admin" : ""}</Text>
          {/* Three figures under the name, each a way in: your posts, your friends, your shifts. */}
          <View style={[styles.stats, { backgroundColor: t.surface, borderColor: t.line }, float(t.dark, 2)]} testID="profile-stats">
            <Stat icon="chatbox-ellipses-outline" value={figures?.notice_count} word="Post" onPress={() => router.push(`/people/${me.username}`)} />
            <View style={[styles.rule, { backgroundColor: t.line }]} />
            <Stat icon="people-outline" value={figures?.friend_count} word="Friend" onPress={() => setOpen("friends")} />
            <View style={[styles.rule, { backgroundColor: t.line }]} />
            <Stat icon="calendar-outline" value={figures?.shift_count} word="Shift" onPress={() => router.push("/work/timesheet")} />
          </View>
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
/**
 * Floating, but crisp: a tight contact shadow and one short lift — never a
 * wide glow. Level 1 is the card, 2 what sits on it. On the dark theme a
 * shadow cannot be seen on black, so there the hairlines carry the lift.
 */
function float(dark: boolean, level: 1 | 2): ViewStyle {
  if (Platform.OS === "android") return { elevation: dark ? 0 : level === 1 ? 2 : 3 };
  return { shadowColor: "#000000", shadowOpacity: dark ? (level === 1 ? 0 : 0.6) : level === 1 ? 0.1 : 0.14, shadowRadius: level === 1 ? 14 : 8, shadowOffset: { width: 0, height: level === 1 ? 6 : 4 } };
}

/** One figure under the name: icon, number, word — a way into what it counts. */
function Stat({ icon, value, word, onPress }: { icon: keyof typeof Ionicons.glyphMap; value?: number; word: string; onPress: () => void }) {
  const t = useTheme();
  const label = value === undefined ? `${word}s` : `${value} ${word.toLowerCase()}${value === 1 ? "" : "s"}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => [styles.stat, { backgroundColor: pressed ? t.surface2 : "transparent" }]}>
    <Ionicons name={icon} size={20} color={t.text2} />
    <Text style={[styles.statValue, { color: t.text }]}>{value === undefined ? "–" : value}</Text>
    <Text style={[styles.statWord, { color: t.muted }]}>{`${word}${value === 1 ? "" : "s"}`}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  surface: {},
  cover: { height: 132, margin: 10, marginBottom: 0, borderRadius: 18, overflow: "hidden" },
  face: { borderRadius: 50 },
  hero: { alignItems: "center", marginTop: -50, paddingHorizontal: 20, paddingBottom: 20, gap: 3 },
  stats: { flexDirection: "row", alignItems: "stretch", alignSelf: "center", maxWidth: 380, width: "100%", marginTop: 18, padding: 6, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  rule: { width: StyleSheet.hairlineWidth, marginVertical: 8 },
  stat: { flex: 1, alignItems: "center", gap: 3, paddingVertical: 8, borderRadius: 14 },
  statValue: { fontSize: 19, fontWeight: "700", letterSpacing: -.3, fontVariant: ["tabular-nums"] },
  statWord: { fontSize: 13 },
  name: { fontSize: 22, fontWeight: "600", letterSpacing: -.55, textAlign: "center", marginTop: 10, alignSelf: "stretch" },
  handle: { fontSize: 14, lineHeight: 20, textAlign: "center", alignSelf: "stretch" },
  edit: { position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 18 },
  menu: { paddingTop: 18, paddingBottom: 8 },
  label: { fontSize: 10, fontWeight: "600", letterSpacing: 1.4, paddingHorizontal: 22, paddingBottom: 6 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 22, marginTop: 8, marginBottom: 4 },
  since: { fontSize: 12, textAlign: "center", marginTop: -8 },
});
