import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useSession } from "@/auth/session";
import { siteUrl } from "@/api/client";
import { Card, Page, PageTitle, Screen } from "@/ui";
import { AppearanceSetting } from "@/ui/AppearanceSetting";
import { BiometricRow } from "@/ui/BiometricRow";
import { PushRow } from "@/ui/PushRow";
import { ProfileRow } from "@/ui/ProfileRow";
import { Version } from "@/ui/Version";
import { notify } from "@/ui/confirm";
import { useTheme } from "@/ui/theme";

export default function ProfileSettings() {
  const { me } = useSession();
  const t = useTheme(), router = useRouter();
  const open = (path: string) => void openBrowserAsync(siteUrl(path)).catch(error => notify("Couldn't open that page", error?.message || "Please try again."));
  if (!me) return null;
  return <Screen back backLabel="Profile" section="Settings">
    <Page>
      <PageTitle sub="Make KaamKoRecord work for you.">Settings</PageTitle>
      <Group title="ON THIS DEVICE">
        <AppearanceSetting minimal />
        <PushRow minimal />
        <BiometricRow username={me.username} minimal />
      </Group>
      <Group title="ACCOUNT & PRIVACY">
        <ProfileRow icon="key-outline" title="Change password" onPress={() => router.push("/profile/password")} testID="change-password" />
        <ProfileRow icon="ban-outline" title="Blocked people" onPress={() => router.push("/profile/blocked")} testID="blocked-people" />
      </Group>
      <Group title="SUPPORT">
        <ProfileRow icon="cloud-offline-outline" title="Offline shifts" onPress={() => router.push("/profile/offline")} />
        <ProfileRow icon="help-circle-outline" title="Report a problem" onPress={() => router.push("/profile/report")} />
      </Group>
      {me.can_manage_festival ? <Group title="ADMINISTRATION">
        <ProfileRow icon="sparkles-outline" title="Festival banner" onPress={() => router.push("/profile/festival")} testID="manage-festival-banner" />
      </Group> : null}
      <View style={styles.legal}>
        <Pressable accessibilityRole="link" onPress={() => open("/safety/rules/")} style={styles.link}><Text style={{ color: t.muted, fontSize: 13 }}>Community rules</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={() => open("/privacy/")} style={styles.link}><Text style={{ color: t.muted, fontSize: 13 }}>Privacy</Text></Pressable>
      </View>
      <ProfileRow icon="trash-outline" title="Delete account" danger centred onPress={() => router.push("/profile/delete")} testID="delete-account" />
      <Version />
    </Page>
  </Screen>;
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ gap: 8 }}>
    <Text style={[styles.label, { color: t.muted }]}>{title}</Text>
    <Card pad={false} style={{ borderWidth: 0, overflow: "hidden" }}>{children}</Card>
  </View>;
}
const styles = StyleSheet.create({
  label: { fontSize: 10, letterSpacing: 1.2, fontWeight: "600", paddingHorizontal: 8 },
  legal: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  link: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
});
