/** You, and the rest: profile, holidays, the site for what isn't here yet, sign out. */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";

import { siteUrl } from "@/api/client";
import { useSession } from "@/auth/session";
import { Avatar, Card, Screen } from "@/ui";
import { confirm } from "@/ui/confirm";
import { sp, useTheme } from "@/ui/theme";

export default function More() {
  const t = useTheme();
  const router = useRouter();
  const { me, signOut } = useSession();

  const Row = ({ icon, title, sub, onPress, tint }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; onPress: () => void; tint?: string }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent" }]}>
      <Ionicons name={icon} size={22} color={tint || t.brand} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: tint || t.text, fontWeight: "600", fontSize: 16 }}>{title}</Text>
        {sub ? <Text style={{ color: t.muted, fontSize: 13 }}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.muted} />
    </Pressable>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: sp[4], gap: sp[3] }}>
        {me ? (
          <Pressable onPress={() => router.push("/profile/edit")}>
            <Card style={styles.me}>
              <Avatar person={me} size={56} live={false} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: "800", fontSize: 18 }}>{me.name}</Text>
                <Text style={{ color: t.muted }}>@{me.username}{me.email ? ` · ${me.email}` : ""}</Text>
              </View>
              <Ionicons name="create-outline" size={22} color={t.muted} />
            </Card>
          </Pressable>
        ) : null}
        <Card pad={false}>
          <Row icon="calendar-outline" title="Public holidays" sub={`The year ahead in ${me?.holiday_state || "your state"}`} onPress={() => router.push("/holidays")} />
          <Row icon="time-outline" title="Timesheets" sub="Clock in, shifts, pay — on the site for now" onPress={() => openBrowserAsync(siteUrl("/timesheet/"))} />
          <Row icon="camera-outline" title="Photo search" sub="Read a picking list — on the site for now" onPress={() => openBrowserAsync(siteUrl("/plu/photo-search/"))} />
        </Card>
        <Card pad={false}>
          <Row icon="log-out-outline" title="Sign out" tint={t.danger} onPress={() => confirm("Sign out?", undefined, "Sign out", signOut)} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  me: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[4] },
});
