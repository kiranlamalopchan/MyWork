/** A face: the photo, or the initial on the person's own hue, with the live dot. */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import type { Person } from "@/api";

import { hsl, useTheme } from "./theme";

export function Avatar({ person, size = 40, live, ring }: { person: Pick<Person, "initial" | "hue" | "photo" | "is_live">; size?: number; live?: boolean; ring?: string }) {
  const t = useTheme();
  const showLive = live ?? person.is_live;
  const dot = Math.max(10, Math.round(size * 0.3));
  return (
    <View style={{ width: size, height: size }}>
      {person.photo ? (
        <Image source={{ uri: person.photo }} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: ring ? 2 : 0, borderColor: ring }} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.initial, { width: size, height: size, borderRadius: size / 2, backgroundColor: hsl(person.hue), borderWidth: ring ? 2 : 0, borderColor: ring }]}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.42 }}>{person.initial}</Text>
        </View>
      )}
      {showLive ? (
        <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2, borderColor: t.surface, backgroundColor: t.brand }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  initial: { alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", right: -1, bottom: -1, borderWidth: 2 },
});
