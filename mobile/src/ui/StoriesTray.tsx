/**
 * The row above the board: a tile to post your own, then one per person
 * with something up — their latest picture, ringed while unseen.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { TrayRow } from "@/api";
import { useSession } from "@/auth/session";

import { Avatar } from "./index";
import { hsl, sp, useTheme } from "./theme";

const W = 96, H = 150;

export function StoriesTray({ rows }: { rows: TrayRow[] }) {
  const t = useTheme();
  const router = useRouter();
  const { me } = useSession();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Pressable onPress={() => router.push("/stories/compose")} style={[styles.tile, { backgroundColor: t.surface, borderColor: t.line }]} testID="story-new">
        <View style={[styles.bg, { backgroundColor: me ? hsl(me.hue) : t.brand }]}>
          {me?.photo ? <Image source={{ uri: me.photo }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        </View>
        <View style={[styles.plus, { backgroundColor: t.brand, borderColor: t.surface }]}>
          <Ionicons name="add" size={20} color={t.brandInk} />
        </View>
        <Text style={[styles.foot, { color: t.text }]}>Create story</Text>
      </Pressable>
      {rows.map((row) => (
        <Pressable key={row.username} onPress={() => router.push(`/stories/${row.username}`)} style={[styles.tile, { borderColor: t.line }]}>
          {row.latest.image ? <Image source={{ uri: row.latest.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: hsl(row.hue) }]} />}
          <View style={styles.shade} />
          <View style={[styles.ring, { borderColor: row.unseen ? t.brand : "rgba(255,255,255,0.7)" }]}>
            <Avatar person={row} size={30} live={false} />
          </View>
          <Text style={styles.name} numberOfLines={1}>{row.mine ? "Your story" : row.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: sp[2], paddingHorizontal: sp[4], paddingVertical: sp[2] },
  tile: { width: W, height: H, borderRadius: 14, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  bg: { height: H * 0.62 },
  plus: { position: "absolute", top: H * 0.62 - 16, alignSelf: "center", width: 32, height: 32, borderRadius: 16, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  foot: { position: "absolute", bottom: 10, width: "100%", textAlign: "center", fontSize: 12, fontWeight: "700" },
  shade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.18)" },
  ring: { position: "absolute", top: 8, left: 8, borderWidth: 2.5, borderRadius: 20, padding: 1 },
  name: { position: "absolute", bottom: 8, left: 8, right: 8, color: "#fff", fontWeight: "700", fontSize: 12, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
});
