import React, { useEffect, useRef, useState } from "react";
import { AppState, Modal, Platform, Text, View } from "react-native";
import { useSession } from "@/auth/session";
import { biometricKind, checkBiometric } from "@/auth/biometric";
import { usePrivateScope, usePrivateState } from "@/storage/private";
import { Button, Card } from "./index";
import { Switch } from "./timesheet";
import { notify } from "./confirm";
import { useTheme, sp } from "./theme";

export function AppLockSetting() {
  const t = useTheme();
  const [enabled, setEnabled, ready] = usePrivateState("app-lock", false, true);
  const [available, setAvailable] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { biometricKind().then(kind => setAvailable(!!kind)); }, []);
  if (!available || Platform.OS === "web") return null;
  return <Card><Switch label="Lock when reopening the app" value={enabled} disabled={!ready || busy} onChange={async next => {
    setBusy(true);
    try { if (await checkBiometric(next ? "Enable app lock" : "Disable app lock")) setEnabled(next); }
    catch (error: any) { notify("Couldn't change app lock", error.message); }
    finally { setBusy(false); }
  }} /><Text style={{ color: t.muted, marginTop: sp[2] }}>Use the phone's biometrics or passcode after the app leaves the foreground.</Text></Card>;
}
export function AppLock({ children }: { children: React.ReactNode }) {
  const { me, signOut } = useSession();
  const scope = usePrivateScope(), currentScope = useRef(scope);
  currentScope.current = scope;
  const [enabled, , ready] = usePrivateState("app-lock", false, true);
  const [unlocked, setUnlocked] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prompting = useRef(false), t = useTheme();
  useEffect(() => { setUnlocked(false); }, [scope]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => {
      if (state !== "active" && !prompting.current) setUnlocked(false);
    });
    return () => listener.remove();
  }, []);
  const locked = !!me && Platform.OS !== "web" && (!ready || enabled && !unlocked);
  return <View style={{ flex: 1 }}>
    <View style={{ flex: 1 }} accessibilityElementsHidden={locked} importantForAccessibility={locked ? "no-hide-descendants" : "auto"}>{children}</View>
    <Modal visible={locked} animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, justifyContent: "center", padding: sp[6], backgroundColor: t.bg, gap: sp[4] }}>
        <Text style={{ color: t.text, fontSize: 24, fontWeight: "700" }}>KaamKoRecord is locked</Text>
        <Text style={{ color: t.muted }}>Unlock with your phone to continue.</Text>
        {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
        <Button title="Unlock" busy={busy} disabled={!ready} onPress={async () => {
          const attemptScope = scope;
          setBusy(true); prompting.current = true; setError("");
          try { if (await checkBiometric("Unlock KaamKoRecord") && currentScope.current === attemptScope) setUnlocked(true); }
          catch { setError("Couldn't unlock. Try again, or sign out and use your password."); }
          finally { prompting.current = false; setBusy(false); }
        }} />
        <Button title="Sign out" kind="plain" onPress={signOut} />
      </View>
    </Modal>
  </View>;
}
