/**
 * The switch for being buzzed — the site's "Notify this device" card on the
 * inbox page, here on the profile beside the one for the phone's lock.
 * On asks the phone once if it has not been asked, then tells the server
 * this phone; off takes the phone back off the server and is remembered,
 * so a later sign-in does not quietly turn it on again. A phone that has
 * blocked the app for good can only be changed in Settings, and the switch
 * says so and opens them. Not shown where there is nothing to switch: the
 * web, Expo Go on Android, a simulator.
 */
import React, { useCallback, useEffect, useState } from "react";
import { AppState, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { disablePush, enablePush, openPushSettings, pushState, type PushState } from "@/push/register";

import { Card } from "./index";
import { success, tick, warn } from "./haptics";
import { notify } from "./confirm";
import { alpha, sp, useTheme } from "./theme";

const WORDS: Record<Exclude<PushState, "unsupported">, string> = {
  on: "On for this phone.",
  off: "Get a notification when something happens on the board, or a shift needs you.",
  blocked: "Blocked for KaamKoRecord in the phone's Settings. Tap the switch to open them.",
};

export function PushRow() {
  const t = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  // Read on arrival and again on coming back from Settings, which is the
  // one place a "blocked" answer changes.
  const look = useCallback(() => { pushState().then(setState).catch(() => setState("unsupported")); }, []);
  useEffect(() => {
    look();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") look(); });
    return () => sub.remove();
  }, [look]);

  if (!state || state === "unsupported") return null;

  const flip = async (next: boolean) => {
    tick();
    if (state === "blocked") {
      openPushSettings().catch(() => {});
      return;
    }
    setBusy(true);
    try {
      if (next) {
        const now = await enablePush();
        setState(now);
        if (now === "on") success();
        else if (now === "blocked") warn();
        else notify("Couldn't turn that on", "The phone said no, or the server couldn't be reached. Try again in a moment.");
      } else {
        await disablePush();
        setState("off");
      }
    } catch (e: any) {
      notify("Couldn't change that", e?.message || "");
      look();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad={false}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: alpha(t.orange, 0.14) }]}>
          <Ionicons name="notifications-outline" size={22} color={t.orange} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: t.text, fontWeight: "600", fontSize: 16, letterSpacing: -0.1 }}>Notify this phone</Text>
          <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2, lineHeight: 18 }} testID="push-status">{WORDS[state]}</Text>
        </View>
        <Switch value={state === "on"} onValueChange={flip} disabled={busy} trackColor={{ true: t.brand }} accessibilityLabel="Notify this phone" testID="push-switch" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: sp[4], paddingHorizontal: sp[4], paddingVertical: sp[3], minHeight: 72 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
