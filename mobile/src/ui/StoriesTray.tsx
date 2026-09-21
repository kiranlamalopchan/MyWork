/**
 * The row above the board (templates/stories/_tray.html): a tile to post
 * your own — your colour on top, a white foot, the plus between — then one
 * 9:16 tile per person with a story up: their latest picture, their face
 * ringed in the brand colour until you have looked, their name at the foot.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { TrayRow } from "@/api";
import { useSession } from "@/auth/session";

import { Avatar } from "./Avatar";
import { useLayout } from "./layout";
import { radius, sp, useTheme } from "./theme";

/**
 * `boxed`: in the hub's side column on a wide screen, where the row is not
 * at the page's edge — so no bleed into the gutter, and tiles of a size
 * that suits a column rather than a share of the screen.
 */
export function StoriesTray({ rows, boxed = false }: { rows: TrayRow[]; boxed?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const { me } = useSession();
  const layout = useLayout();
  // 9:16 tiles: three and a bit across a phone, whatever its width.
  const W = boxed ? 100 : Math.round(Math.min(112, Math.max(88, (layout.width - 2 * layout.gutter - 2 * sp[2]) / 3.3)));
  const H = Math.round((W * 16) / 9);
  const side = boxed ? 0 : (layout.column.paddingLeft as number);
  const tile = { width: W, height: H };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { paddingHorizontal: side }]} style={{ marginHorizontal: -side }}>
      <Pressable onPress={() => router.push("/stories/compose")} style={[styles.tile, tile, { backgroundColor: t.surface }]} testID="story-new">
        <View style={[styles.bgNew, { height: H * 0.66 }]}>
          {me?.photo ? (
            <Image source={{ uri: me.photo }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: `hsl(${me?.hue ?? 160}, 55%, 50%)` }]} />
          )}
        </View>
        <View style={[styles.plus, { top: H * 0.66 - 16, backgroundColor: t.brand, borderColor: t.surface }]}>
          <Ionicons name="add" size={20} color={t.brandInk} />
        </View>
        <Text style={[styles.foot, { color: t.text }]}>Create story</Text>
      </Pressable>
      {rows.map((row) => {
        const ring = row.unseen || row.mine ? t.brand : t.lineStrong;
        return (
          <Pressable key={row.username} onPress={() => router.push(`/stories/${row.username}`)} style={[styles.tile, tile, { backgroundColor: t.surface3 }]} accessibilityLabel={`${row.mine ? "Your story" : row.name}, ${row.count} photo${row.count === 1 ? "" : "s"}`}>
            {row.latest.image ? <Image source={{ uri: row.latest.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
            <View style={[styles.shade, { backgroundColor: "rgba(0,0,0,0.42)" }]} />
            <View style={[styles.ring, { backgroundColor: t.surface, borderColor: ring }]}>
              <Avatar person={row} size={28} live={false} />
            </View>
            <Text style={styles.name} numberOfLines={2}>{row.mine ? "Your story" : row.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: sp[2], paddingTop: 2, paddingBottom: sp[2] },
  tile: { borderRadius: radius.md, overflow: "hidden" },
  bgNew: { position: "absolute", top: 0, left: 0, right: 0 },
  plus: { position: "absolute", alignSelf: "center", width: 32, height: 32, borderRadius: 16, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  foot: { position: "absolute", bottom: 8, width: "100%", textAlign: "center", fontSize: 12, fontWeight: "700" },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 44 },
  ring: { position: "absolute", top: 8, left: 8, padding: 2, borderRadius: 20, borderWidth: 2.5 },
  name: { position: "absolute", bottom: 8, left: 8, right: 8, color: "#fff", fontWeight: "700", fontSize: 12.5, lineHeight: 15, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
});
