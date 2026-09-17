/**
 * The clock (templates/timeclock/dashboard.html): one of three states — ready
 * to clock in, working, or on a break — the dial counting, and the buttons
 * that move between them. That, where you are, and the hours cap you are
 * working against. Nothing else: the timesheet is one tap away for figures.
 */
import React, { useEffect, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";

import { timesheet, useClock, useTimesheetChanged, type ClockState } from "@/api";
import { Button, Chip, Empty, ErrorBanner, Page, Screen, useLayout } from "@/ui";
import { SkeletonClock } from "@/ui/Skeleton";
import { confirm, notify } from "@/ui/confirm";
import { success, tap } from "@/ui/haptics";
import { alpha, radius, sp, useTheme } from "@/ui/theme";
import { CashTallyCard, LimitBar, StatusPill } from "@/ui/timesheet";

const R = 52, C = 2 * Math.PI * R;

export default function Clock() {
  const t = useTheme();
  const router = useRouter();
  const layout = useLayout();
  // The dial: as big as the column allows, never more than a hand's span.
  const DIAL = Math.round(Math.min(300, Math.max(220, layout.width - 2 * layout.gutter - 60)));
  const changed = useTimesheetChanged();
  const [state, setState] = useState<ClockState | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  // The job chosen drives the ask: the cap under the dial belongs to whichever
  // job is picked, and asking again is the only way to know what it is.
  const q = useClock(picked);
  const [busy, setBusy] = useState(false);
  const shown = state || q.data || null;
  // Picked here, or else whichever the server said was yours.
  const selected = picked ?? shown?.selected ?? null;
  useEffect(() => { if (q.data) setState(q.data); }, [q.data]);

  // The phone's clock may be off; count from the server's, as app.js does.
  const [skew, setSkew] = useState(0);
  useEffect(() => { if (shown) setSkew(Date.now() - Date.parse(shown.server_now)); }, [shown?.server_now]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!shown?.shift) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [shown?.shift?.id, shown?.shift?.status]);

  const act = async (what: () => Promise<ClockState>) => {
    setBusy(true);
    tap("heavy");
    try {
      const next = await what();
      setState(next);
      success();
      changed();
      if (next.finished) router.push(`/shifts/${next.finished}`);
    } catch (e: any) {
      notify("The clock didn't move", e?.message || "Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading && !shown) return <Screen><Page><SkeletonClock /></Page></Screen>;
  if (!shown) return <Screen><Page>{q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}</Page></Screen>;

  const shift = shown.shift;
  const status = shift?.status ?? "IDLE";
  const now = Date.now() - skew;
  let elapsed = 0, label = "Current time", sub = "", timeText = "";
  if (shift && status === "ON_BREAK" && shift.running_break) {
    elapsed = Math.max(0, (now - Date.parse(shift.running_break.start)) / 1000);
    label = "On break"; timeText = hms(elapsed); sub = `since ${shift.running_break.start_at}`;
  } else if (shift) {
    const total = Math.max(0, (now - Date.parse(shift.clock_in)) / 1000);
    elapsed = Math.max(0, total - shift.banked_break_seconds);
    label = "Worked"; timeText = hms(elapsed);
    sub = `in since ${shift.in_at}${shift.total_break.seconds ? ` · ${shift.total_break.minutes} break` : ""}`;
  } else {
    const d = new Date(now);
    timeText = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
    const ampm = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/^[\d:]+\s?/, "");
    sub = `${ampm ? `${ampm} · ` : ""}ready when you are`;
  }
  const progress = shift ? Math.min(elapsed / (shown.target_hours * 3600), 1) : 0;
  const ring = status === "ON_BREAK" ? t.warn : status === "WORKING" ? t.brand : t.lineStrong;
  const where = shift ? shift.workplace?.name : shown.workplaces.find((w) => w.id === selected)?.name;

  return (
    <Screen>
      <Page refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={t.brand} />}>
        {shown.workplaces.length === 0 ? (
          <Empty
            icon="home-outline"
            title="Add a workplace first"
            sub="You need somewhere to clock in at before the timer can start."
            action={<Button title="Add workplace" icon="add" onPress={() => router.push("/workplaces/new")} />}
          />
        ) : (
          <>
            <View style={styles.head}>
              <StatusPill status={status} label={shift ? shift.status_label : "Not started"} />
              <Text style={{ color: t.muted, fontSize: 13 }}>{shown.today}</Text>
            </View>
            {shown.long_shift ? (
              <View style={[styles.alert, { backgroundColor: alpha(t.warn, 0.16), borderColor: alpha(t.warn, 0.45) }]}>
                <Ionicons name="alert-circle-outline" size={18} color={t.warn} />
                <Text style={{ color: t.warn, flex: 1, fontSize: 14, lineHeight: 20 }}>This shift has been running over {shown.target_hours} hours. If you forgot to clock out, edit the time after you do.</Text>
              </View>
            ) : null}

            <View style={[styles.dial, { width: DIAL, height: DIAL }]}>
              <View style={[styles.disc, { width: DIAL * 0.87, height: DIAL * 0.87, borderRadius: DIAL * 0.435, backgroundColor: t.surface, borderColor: t.dark ? t.line : "transparent" }, !t.dark && { shadowColor: t.shadow, shadowOpacity: 0.09, shadowRadius: 28, shadowOffset: { width: 0, height: 14 } }]} />
              <Svg width={DIAL} height={DIAL} viewBox="0 0 120 120">
                <Circle cx="60" cy="60" r={R} stroke={t.dark ? t.surface3 : t.surface2} strokeWidth={8} fill="none" />
                <Circle
                  cx="60" cy="60" r={R} stroke={ring} strokeWidth={8} fill="none" strokeLinecap="round"
                  strokeDasharray={`${C}`} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 60 60)"
                />
              </Svg>
              <View style={styles.face}>
                <Text style={[styles.dialLabel, { color: t.muted }]}>{label}</Text>
                <Text style={[styles.dialTime, { color: t.text, fontSize: Math.round((shift ? 40 : 50) * (DIAL / 280)) }]} testID="dial-time">{timeText}</Text>
                <Text style={{ color: t.muted, fontSize: 13, marginTop: sp[2] }}>{sub}</Text>
              </View>
            </View>

            {!shift ? (
              <>
                {shown.workplaces.length > 1 ? (
                  <View style={{ gap: sp[2] }}>
                    <Text style={[styles.sectionLabel, { color: t.muted }]}>Where are you working?</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }}>
                      {shown.workplaces.map((w) => (
                        <Chip key={w.id} on={w.id === selected} onPress={() => setPicked(w.id)}>{w.name}{w.is_default ? "  ·  Default" : ""}</Chip>
                      ))}
                    </View>
                  </View>
                ) : (
                  <Where name={where} />
                )}
                <BigButton title="Clock in" icon="time-outline" kind="go" busy={busy} onPress={() => selected && act(() => timesheet.clockIn(selected))} testID="clock-in" />
              </>
            ) : status === "ON_BREAK" ? (
              <>
                <Where name={where} />
                <BigButton title="End break" icon="play" kind="go" busy={busy} onPress={() => act(timesheet.endBreak)} testID="end-break" />
              </>
            ) : (
              <>
                <Where name={where} />
                <View style={{ flexDirection: layout.compact ? "column" : "row", gap: sp[3] }}>
                  <BigButton title="Break" icon="pause" kind="soft" busy={busy} onPress={() => act(timesheet.startBreak)} testID="start-break" style={layout.compact ? undefined : { flex: 1 }} />
                  <BigButton title="Clock out" icon="stop" kind="stop" busy={busy} onPress={() => confirm("Clock out?", undefined, "Clock out", () => act(timesheet.clockOut), false)} testID="clock-out" style={layout.compact ? undefined : { flex: 1 }} />
                </View>
              </>
            )}
            {shown.limit ? <LimitBar limit={shown.limit} /> : shown.tally ? <CashTallyCard tally={shown.tally} /> : null}
          </>
        )}
      </Page>
    </Screen>
  );
}

const hms = (s: number) => {
  const n = Math.floor(s);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(Math.floor(n / 3600))}:${pad(Math.floor((n % 3600) / 60))}:${pad(n % 60)}`;
};

function Where({ name }: { name?: string }) {
  const t = useTheme();
  if (!name) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sp[2] }}>
      <Ionicons name="home-outline" size={18} color={t.muted} />
      <Text style={{ color: t.text, fontWeight: "700", fontSize: 17 }}>{name}</Text>
    </View>
  );
}

function BigButton({ title, icon, kind, onPress, busy, testID, style }: { title: string; icon: keyof typeof Ionicons.glyphMap; kind: "go" | "stop" | "soft"; onPress: () => void; busy?: boolean; testID?: string; style?: any }) {
  const t = useTheme();
  const bg = kind === "go" ? t.brand : kind === "stop" ? t.danger : t.dark ? t.surface3 : t.surface;
  const ink = kind === "go" ? t.brandInk : kind === "stop" ? "#fff" : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      testID={testID}
      style={({ pressed }) => [styles.big, { backgroundColor: bg, opacity: busy ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, kind !== "soft" ? { shadowColor: bg, shadowOpacity: t.dark ? 0 : 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } } : !t.dark && { shadowColor: t.shadow, shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } }, style]}
    >
      <Ionicons name={icon} size={22} color={ink} />
      <Text style={{ color: ink, fontSize: 18, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[3] },
  alert: { flexDirection: "row", alignItems: "center", gap: sp[2], padding: sp[3], borderRadius: radius.md, borderWidth: 1 },
  dial: { alignItems: "center", justifyContent: "center", alignSelf: "center", marginVertical: sp[2] },
  disc: { position: "absolute", borderWidth: 1 },
  face: { position: "absolute", alignItems: "center", paddingHorizontal: sp[6] },
  dialLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase" },
  dialTime: { fontWeight: "800", letterSpacing: -1.5, fontVariant: ["tabular-nums"], marginTop: 4 },
  sectionLabel: { fontSize: 13.5, fontWeight: "700" },
  big: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sp[2], minHeight: 58, borderRadius: radius.pill, paddingHorizontal: sp[5] },
});
