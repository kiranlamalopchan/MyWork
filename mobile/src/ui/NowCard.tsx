/**
 * "Right now": the clock at a glance, in the wide hub's header — where you
 * are clocked in and since when, that you are on a break, or that you are
 * not clocked in at all — and the way to the clock itself. The figure that
 * ticks lives on the Clock tab; this shows it as the server last gave it,
 * which is what a glance on the way past wants.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { ClockState } from "@/api/types";

import { Button, Card } from "./index";
import { sp, useTheme } from "./theme";

export function NowCard({ clock, style }: { clock?: ClockState; style?: object }) {
  const t = useTheme();
  const router = useRouter();
  const shift = clock?.shift ?? null;
  const onBreak = !!shift?.running_break;
  const dot = !shift ? t.muted : onBreak ? t.warn : t.brand;
  const label = !shift ? "Not clocked in" : onBreak ? "On a break" : "Clocked in";
  const fallback = clock?.workplaces.find((w) => w.id === clock.selected) ?? clock?.workplaces.find((w) => w.is_default) ?? clock?.workplaces[0];
  const where = shift?.workplace?.name ?? fallback?.name ?? "No workplace yet";
  const sub = !clock
    ? " "
    : shift
      ? onBreak
        ? `Since ${shift.running_break!.start_at} · ${shift.worked.hm} worked before it`
        : `Since ${shift.in_at} · ${shift.worked.hm} so far`
      : fallback
        ? "Ready when you are."
        : "Add one on the Clock tab.";
  return (
    <Card style={[styles.card, style]} testID="now-card">
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={[styles.label, { color: t.muted }]}>{label}</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name="time-outline" size={16} color={t.muted} />
      </View>
      <Text style={[styles.where, { color: t.text }]} numberOfLines={1}>{where}</Text>
      <Text style={[styles.sub, { color: t.muted }]} numberOfLines={1}>{sub}</Text>
      <Button
        title={shift ? "Open the clock" : "Clock in"}
        kind={shift ? "plain" : "primary"}
        size="sm"
        icon={shift ? "chevron-forward" : "play"}
        onPress={() => router.navigate("/clock")}
        style={{ alignSelf: "flex-start", marginTop: sp[3] }}
        testID="now-open"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: 320 },
  head: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  label: { fontSize: 12.5, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase" },
  where: { fontSize: 21, fontWeight: "800", letterSpacing: -0.4, marginTop: sp[2] },
  sub: { fontSize: 13.5, marginTop: 3 },
});
