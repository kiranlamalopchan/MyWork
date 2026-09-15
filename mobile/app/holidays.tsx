/** The year ahead, month by month, for your state. */
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useUpcomingHolidays } from "@/api";
import { Card, Empty, ErrorBanner, Loading, Screen } from "@/ui";
import { sp, useTheme } from "@/ui/theme";

export default function Holidays() {
  const t = useTheme();
  const q = useUpcomingHolidays();
  const byMonth = new Map<string, NonNullable<typeof q.data>["holidays"]>();
  for (const h of q.data?.holidays ?? []) {
    const key = new Date(h.date).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    byMonth.set(key, [...(byMonth.get(key) || []), h]);
  }
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: sp[4], gap: sp[3] }}>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <Loading /> : null}
        {q.data && q.data.holidays.length === 0 ? <Empty icon="calendar-outline" title={`Nothing loaded for ${q.data.state}`} sub="The server syncs holidays on a schedule." /> : null}
        {[...byMonth.entries()].map(([month, rows]) => (
          <View key={month} style={{ gap: sp[2] }}>
            <Text style={[styles.month, { color: t.muted }]}>{month}</Text>
            {rows.map((h) => (
              <Card key={h.date + h.name} style={styles.row}>
                <View style={[styles.date, { backgroundColor: t.brandSoft }]}>
                  <Text style={{ color: t.brand, fontWeight: "800", fontSize: 11 }}>{h.month_short}</Text>
                  <Text style={{ color: t.brand, fontWeight: "800", fontSize: 20, lineHeight: 22 }}>{h.day}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{h.name}</Text>
                  <Text style={{ color: t.text2, fontSize: 13 }}>{h.weekday} · {h.countdown}{h.is_national ? "" : ` · ${h.scope}`}</Text>
                </View>
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  month: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  date: { width: 48, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
