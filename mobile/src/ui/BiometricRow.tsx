/**
 * The switch for signing in with the phone's lock — Face ID, a
 * fingerprint — on the profile page. Turning it on asks the lock once,
 * then keeps this sign-in for it; off drops what was kept. Not shown on
 * a phone without a lock, or on the web.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import { armBiometric, biometricKind, biometricName, biometricUser, checkBiometric, disarmBiometric, type BiometricKind } from "@/auth/biometric";
import { getToken } from "@/auth/token";

import { BiometricIcon } from "./BiometricIcon";
import { Card } from "./index";
import { success, tick } from "./haptics";
import { notify } from "./confirm";
import { alpha, sp, useTheme } from "./theme";

export function BiometricRow({ username }: { username: string }) {
  const t = useTheme();
  const [kind, setKind] = useState<BiometricKind | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [k, who] = await Promise.all([biometricKind(), biometricUser()]);
      if (!live) return;
      setKind(k);
      setOn(!!k && who === username);
    })();
    return () => { live = false; };
  }, [username]);

  if (!kind) return null;
  const name = biometricName(kind);

  const flip = async (next: boolean) => {
    tick();
    setBusy(true);
    try {
      if (next) {
        // The lock has to be met once before it is trusted with the sign-in.
        if (!(await checkBiometric(`Use ${name} to sign in to MeroKaam`))) return;
        const token = await getToken();
        if (!token) return;
        await armBiometric(username, token);
        success();
        setOn(true);
      } else {
        await disarmBiometric();
        setOn(false);
      }
    } catch (e: any) {
      notify("Couldn't change that", e?.message || "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad={false}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: alpha(t.teal, 0.14) }]}>
          <BiometricIcon kind={kind} size={22} color={t.teal} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: t.text, fontWeight: "600", fontSize: 16, letterSpacing: -0.1 }}>Sign in with {name}</Text>
          <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2, lineHeight: 18 }}>{on ? "On for this phone — no password next time." : "Open the app with the phone's lock instead of a password."}</Text>
        </View>
        <Switch value={on} onValueChange={flip} disabled={busy} trackColor={{ true: t.brand }} accessibilityLabel={`Sign in with ${name}`} testID="biometric-switch" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: sp[4], paddingHorizontal: sp[4], paddingVertical: sp[3], minHeight: 72 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
