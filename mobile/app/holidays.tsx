/**
 * The year ahead (templates/holidays/calendar.html), for one state: the
 * page folds into months and opens only the one you are in; the headings
 * are the navigation. The state is chosen from the phone's own dropdown;
 * changing it changes the page, not your setting.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useUpcomingHolidays } from "@/api";
import { useSession } from "@/auth/session";
import { Card, Empty, ErrorBanner, Loading, Page, PageTitle, Screen } from "@/ui";
import { Select } from "@/ui/Select";
import { alpha, radius, sp, useTheme } from "@/ui/theme";

const LABELS: Record<string, string> = {
  ACT: "Australian Capital Territory", NSW: "New South Wales", NT: "Northern Territory", QLD: "Queensland",
  SA: "South Australia", TAS: "Tasmania", VIC: "Victoria", WA: "Western Australia",
};

export default function Holidays() {
  const t = useTheme();
  const { me } = useSession();
  const [state, setState] = useState<string | undefined>(undefined);
  const q = useUpcomingHolidays(state);
  const shown = q.data?.state || state || me?.holiday_state || "NSW";
  const [open, setOpen] = useState<string | null>(null);

  const months: { key: string; month: string; year: string; rows: NonNullable<typeof q.data>["holidays"] }[] = [];
  for (const h of q.data?.holidays ?? []) {
    const d = new Date(h.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let m = months.find((x) => x.key === key);
    if (!m) { m = { key, month: d.toLocaleDateString(undefined, { month: "long" }), year: String(d.getFullYear()), rows: [] }; months.push(m); }
    m.rows.push(h);
  }
  const current = open ?? months[0]?.key ?? null;
  const total = q.data?.holidays.length ?? 0;

  return (
    <Screen back backLabel="Home">
      <Page>
        <PageTitle sub={`${LABELS[shown] || shown}${total ? ` · ${total} date${total === 1 ? "" : "s"} ahead` : ""}`}>Public holidays</PageTitle>
        <Select
          label="State"
          value={shown}
          options={(q.data?.states || Object.keys(LABELS)).map((s) => ({ value: s, label: LABELS[s] ? `${LABELS[s]} (${s})` : s }))}
          onChange={(s) => { setState(s); setOpen(null); }}
          testID="holiday-state"
        />
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <Loading /> : null}
        {q.data && total === 0 ? <Empty icon="calendar-outline" title={`Nothing loaded for ${LABELS[shown] || shown} yet`} sub="A staff member loads the year's calendar on the site." /> : null}
        {months.map((m) => {
          const isOpen = m.key === current;
          return (
            <View key={m.key}>
              <Pressable onPress={() => setOpen(isOpen ? "" : m.key)} style={[styles.month, { borderBottomColor: t.line }]}>
                <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{m.month} <Text style={{ color: t.muted, fontWeight: "500", fontSize: 15 }}>{m.year}</Text></Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
                  {!isOpen ? <Text style={{ color: t.muted, fontSize: 14 }}>{m.rows.length} date{m.rows.length === 1 ? "" : "s"}</Text> : null}
                  <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
                </View>
              </Pressable>
              {isOpen ? (
                <View style={{ gap: sp[2], paddingTop: sp[3] }}>
                  {m.rows.map((h) => (
                    <Card key={h.date + h.name} pad={false} style={styles.row}>
                      <View style={[styles.date, { backgroundColor: alpha(t.brand, 0.09), borderColor: alpha(t.brand, 0.16) }]}>
                        <Text style={{ color: t.brandStrong, fontWeight: "800", fontSize: 10, letterSpacing: 0.8 }}>{h.month_short.toUpperCase()}</Text>
                        <Text style={{ color: t.text, fontWeight: "700", fontSize: 20, lineHeight: 23 }}>{h.day}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{h.name}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2], flexWrap: "wrap" }}>
                          <Text style={{ color: t.muted, fontSize: 14 }}>{h.weekday} · {h.countdown}</Text>
                          <Text style={[styles.pill, h.is_national ? { backgroundColor: t.brandSoft, color: t.brandStrong } : { backgroundColor: t.warnSoft, color: t.warn }]}>{h.scope}</Text>
                        </View>
                      </View>
                    </Card>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  month: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: sp[3], paddingHorizontal: sp[2], borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3] },
  date: { width: 48, paddingVertical: 5, alignItems: "center", borderRadius: radius.md, borderWidth: 1 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, fontSize: 11, fontWeight: "700", overflow: "hidden" },
});
