/**
 * The month (templates/timeclock/calendar.html): a grid with the hours worked
 * on each day and a line under it showing how the day divided between jobs,
 * the key below, and the shifts behind whichever day is tapped.
 *
 * Drawn without a page around it, so the timesheet can put it where the list
 * was — the two are one screen with a switch, not two screens.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useCalendar, type CalendarCell } from "@/api";
import { Card, ErrorBanner, IconButton, useLayout } from "@/ui";
import { SkeletonCalendar } from "@/ui/Skeleton";
import { radius, sp, useTheme } from "@/ui/theme";
import { cssColour, hslAlpha, ShiftRow, Swatch } from "@/ui/timesheet";

export function CalendarView() {
  const t = useTheme();
  const router = useRouter();
  const [ym, setYm] = useState<{ year?: number; month?: number }>({});
  const [day, setDay] = useState<string | null>(null);
  const q = useCalendar(ym.year, ym.month, day);
  const data = q.data;

  return (
    <>
    {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
    {q.isLoading && !data ? <SkeletonCalendar /> : null}
    {data ? (
      <Card pad={false} style={{ padding: sp[3] }}>
        <View style={styles.bar}>
          <IconButton icon="chevron-back" label="Previous month" onPress={() => { setYm(data.prev); setDay(null); }} style={{ backgroundColor: t.surface2 }} />
          <View style={{ alignItems: "center", flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 18 }}>{data.label}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>{data.month_total.hm} over {data.worked_days} day{data.worked_days === 1 ? "" : "s"}</Text>
          </View>
          <IconButton icon="chevron-forward" label="Next month" onPress={() => { setYm(data.next); setDay(null); }} style={{ backgroundColor: t.surface2 }} />
        </View>
        <View style={styles.row}>
          {data.weekday_labels.map((l, i) => <Text key={i} style={[styles.cell, { color: t.muted, fontSize: 12, fontWeight: "700", textAlign: "center" }]}>{l}</Text>)}
        </View>
        {data.weeks.map((week, wi) => (
          <View key={wi} style={styles.row}>
            {week.map((cell) => <Cell key={cell.date} cell={cell} picked={cell.date === data.selected} onPress={() => setDay(cell.date)} />)}
          </View>
        ))}
        {data.legend.length ? (
          <View style={[styles.key, { borderTopColor: t.line }]}>
            {data.legend.map((place) => (
              <View key={place.name} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Swatch css={cssColour(place.css)} size={12} />
                <Text style={{ color: t.text, fontWeight: "700", fontSize: 13.5 }}>{place.name}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>{place.worked.hm}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    ) : null}
    {data?.selected ? (
      <Card pad={false}>
        <View style={[styles.dayHead, { borderBottomColor: t.line }]}>
          <Text style={[styles.sectionLabel, { color: t.muted }]}>{data.selected_label}</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>{data.selected_total.hm}</Text>
        </View>
        {data.selected_shifts.length ? (
          data.selected_shifts.map((s, i) => <ShiftRow key={s.id} shift={s} count={data.selected_shifts.length} last={i === data.selected_shifts.length - 1} />)
        ) : (
          <Text style={{ color: t.muted, fontSize: 14, padding: sp[4] }}>Nothing recorded on this day.</Text>
        )}
        <Pressable onPress={() => router.push({ pathname: "/shifts/new", params: { day: data.selected! } })} style={[styles.daylink, { borderTopColor: t.line }]}>
          <Ionicons name="add" size={18} color={t.brand} />
          <Text style={{ color: t.brand, fontWeight: "700", fontSize: 15 }}>Add a shift on this day</Text>
        </Pressable>
      </Card>
    ) : null}
    </>
  );
}

function Cell({ cell, picked, onPress }: { cell: CalendarCell; picked: boolean; onPress: () => void }) {
  const t = useTheme();
  const { compact } = useLayout();
  const has = !!cell.total;
  const lead = cssColour(cell.lead);
  return (
    <Pressable
      onPress={has ? onPress : undefined}
      accessibilityLabel={has ? `${cell.date}, ${cell.total!.hm} worked` : cell.date}
      style={[styles.cell, styles.day, compact && { minHeight: 48 }, has && { backgroundColor: hslAlpha(lead, 0.14) }, picked && { borderColor: lead }, !has && cell.is_today && { alignItems: "center" }]}
    >
      <View style={[cell.is_today && !has && { backgroundColor: t.text, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: cell.is_today && !has ? t.bg : !cell.in_month ? t.lineStrong : t.text, fontWeight: has || cell.is_today ? "700" : "500", fontSize: 14, textAlign: "center" }}>{cell.day}</Text>
      </View>
      {has ? <Text style={{ color: t.text2, fontSize: 9.5, fontWeight: "600", textAlign: "center", letterSpacing: -0.3 }} numberOfLines={1}>{cell.total!.hm}</Text> : null}
      {has ? (
        <View style={[styles.track, { backgroundColor: t.surface3 }]}>
          {cell.track.map((seg, i) => <View key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${seg.left}%`, width: `${seg.width}%`, backgroundColor: cssColour(seg.css) }} />)}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: sp[2], marginBottom: sp[2] },
  row: { flexDirection: "row", gap: 3, marginBottom: 3 },
  cell: { flex: 1, minWidth: 0 },
  day: { minHeight: 54, borderRadius: radius.sm, paddingTop: 4, paddingBottom: 5, paddingHorizontal: 0, gap: 1, borderWidth: 2, borderColor: "transparent", justifyContent: "flex-start" },
  track: { position: "absolute", left: 4, right: 4, bottom: 3, height: 4, borderRadius: 2, overflow: "hidden" },
  key: { flexDirection: "row", flexWrap: "wrap", gap: sp[3], marginTop: sp[3], paddingTop: sp[3], borderTopWidth: StyleSheet.hairlineWidth },
  dayHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  sectionLabel: { fontSize: 13.5, fontWeight: "700", letterSpacing: -0.1 },
  daylink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: sp[3], borderTopWidth: StyleSheet.hairlineWidth },
});
