/**
 * Two settings that live on the phone, not the account: the language the
 * app is in, and how the phone reminds you about work — how long before a
 * rostered shift, and whether a running shift is kept on the lock screen.
 */
import React, { useEffect, useState } from "react";
import { Platform, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import type { ClockState, RosterPage } from "@/api";
import { errorMessage } from "@/api/errors";
import { syncWorkWidgets } from "@/widgets/sync";
import { getLang, LANGUAGES, setLang, useT, type Lang } from "@/i18n";
import { askForPush } from "@/push/register";
import { getLead, LEADS, leadWords, lockScreenOn, registerClockActions, setLead, setLockScreen, syncClock, syncShiftReminders } from "@/roster/reminders";

import { notify } from "./confirm";
import { Select } from "./Select";
import { sp, useTheme } from "./theme";

const rowStyle = { paddingHorizontal: 22, paddingVertical: 16, gap: sp[3] } as const;

function Head({ icon, title, sub }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
      <Ionicons name={icon} size={20} color={t.text2} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 15 }}>{title}</Text>
        <Text style={{ color: t.muted, fontSize: 13, marginTop: sp[1], lineHeight: 18 }}>{sub}</Text>
      </View>
    </View>
  );
}

export function LanguageSetting() {
  const tr = useT();
  return (
    <View style={rowStyle}>
      <Head icon="language-outline" title={tr("Language")} sub={tr("Menus and buttons. Notifications and some pages stay in English.")} />
      <Select label={tr("Language")} value={getLang()} options={LANGUAGES} testID="language-select"
        onChange={(value) => {
          setLang(value as Lang);
          // The buttons on a clock notification are worded once, when they are registered.
          void registerClockActions();
        }} />
    </View>
  );
}

export function ShiftReminderSetting() {
  const t = useTheme(), tr = useT();
  const client = useQueryClient();
  const [lead, setLeadState] = useState<number | null>(null);
  const [lock, setLock] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getLead().then(setLeadState).catch(() => setLeadState(0));
    lockScreenOn().then(setLock).catch(() => {});
  }, []);

  /** Either setting is only a wish until the phone has said it may be buzzed. */
  const permitted = async () => {
    if (await askForPush()) return true;
    notify(tr("Notifications are off"), tr("Allow notifications for KaamKoRecord in the phone's Settings, then turn this on again."));
    return false;
  };
  const roster = () => client.getQueryData<RosterPage>(["roster"])?.mine ?? [];

  const chooseLead = async (minutes: number) => {
    if (busy) return;
    setBusy(true);
    try {
      if (minutes && !(await permitted())) return;
      await setLead(minutes);
      setLeadState(minutes);
      await syncShiftReminders(roster());
    } catch (error) { notify(tr("That didn't work"), errorMessage(error)); }
    finally { setBusy(false); }
  };
  const flipLock = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (on && !(await permitted())) return;
      await setLockScreen(on);
      setLock(on);
      const clock = client.getQueryData<ClockState>(["clock", null]);
      if (on) await syncClock(clock, roster());
      await syncWorkWidgets(clock ?? null, roster(), on);
    } catch (error) { notify(tr("That didn't work"), errorMessage(error)); }
    finally { setBusy(false); }
  };

  if (lead === null) return null;
  return (
    <>
      <View style={rowStyle}>
        <Head icon="alarm-outline" title={tr("Shift reminder")} sub={tr("An alarm from this phone before each shift on your roster.")} />
        <Select label={tr("Shift reminder")} value={String(lead)} options={LEADS.map((m) => ({ value: String(m), label: leadWords(m) }))}
          onChange={(value) => { void chooseLead(Number(value)); }} testID="reminder-lead" />
      </View>
      <View style={[rowStyle, { flexDirection: "row", alignItems: "center" }]}>
        <View style={{ flex: 1 }}>
          <Head icon="lock-closed-outline" title={tr("Running shift on the lock screen")} sub={tr("Shows that you are clocked in, with buttons for a break and clocking out.")} />
        </View>
        <Switch disabled={busy} accessibilityLabel={tr("Running shift on the lock screen")} value={lock} onValueChange={(on) => { void flipLock(on); }}
          trackColor={{ false: t.lineStrong, true: t.brand }} thumbColor={Platform.OS === "android" ? t.surface : undefined} testID="lockscreen-toggle" />
      </View>
    </>
  );
}
