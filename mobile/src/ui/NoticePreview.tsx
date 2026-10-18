import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Notice } from "@/api";
import { Avatar } from "./Avatar";
import { AdminBadge } from "./AdminBadge";
import { NoticeSurface } from "./NoticeSurface";
import { VisibilityBadge } from "./VisibilityPicker";
import { sp, useTheme } from "./theme";

/** Home's read-only preview; native navigation opens the full conversation. */
export function NoticePreview({ notice }: { notice: Notice }) {
  const t = useTheme(), router = useRouter();
  return <NoticeSurface notice={notice} onPress={() => router.push(`/notices/${notice.id}`)} style={styles.card}>
    {notice.pinned ? <View style={styles.pinned}><Ionicons name="pin" size={13} color={t.brand} /><Text style={{ color: t.brand, fontSize: 12, fontWeight: "700" }}>Pinned</Text></View> : null}
    <View style={styles.main}>
      <Avatar person={notice.author} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.head}>
          <Text style={{ color: t.text, fontSize: 14, fontWeight: "700", flexShrink: 1 }}>{notice.mine ? "You" : notice.author.username}</Text>
          <AdminBadge person={notice.author} />
          <Text style={{ color: t.muted, fontSize: 12 }}>{notice.ago}{notice.edited ? " · edited" : ""}</Text>
          <VisibilityBadge visibility={notice.visibility} />
        </View>
        <Text style={{ color: t.text2, fontSize: 14.5, lineHeight: 22, marginTop: 3 }}>{notice.body}</Text>
      </View>
    </View>
    <View style={styles.open}><Text style={{ color: t.muted, fontSize: 12 }}>Open post</Text><Ionicons name="chevron-forward" size={15} color={t.muted} /></View>
  </NoticeSurface>;
}

const styles = StyleSheet.create({
  card: { padding: sp[4], gap: sp[3] },
  main: { flexDirection: "row", alignItems: "flex-start", gap: sp[3] },
  head: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: sp[2] },
  pinned: { flexDirection: "row", alignItems: "center", gap: 5 },
  open: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
});
