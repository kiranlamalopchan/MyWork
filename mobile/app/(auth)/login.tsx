/**
 * Signing in: a username and a password — or, once a password has been
 * given on this phone and the person said yes, the phone's own lock
 * (Face ID, a fingerprint), behind the small button at the end of the
 * password box: the lock is asked only when that is pressed.
 */
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { biometricKind, biometricName, biometricUser, unlockWithBiometric, type BiometricKind } from "@/auth/biometric";
import { useSession } from "@/auth/session";
import { welcome } from "@/auth/welcome";
import { Button, Field, Input } from "@/ui";
import { AuthFrame } from "@/ui/AuthFrame";
import { BiometricIcon } from "@/ui/BiometricIcon";
import { fail, success, tap, tick } from "@/ui/haptics";
import { useReveal } from "@/ui/keyboard";
import { radius, sp, useTheme } from "@/ui/theme";

export default function Login() {
  const t = useTheme();
  const { signIn, signInWithToken } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The lock: what kind the phone has, and who it opens for here.
  const [kind, setKind] = useState<BiometricKind | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const reveal = useReveal();
  const boxRef = useRef<View>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [k, who] = await Promise.all([biometricKind(), biometricUser()]);
      if (!live) return;
      setKind(k);
      setLocked(k ? who : null);
    })();
    return () => { live = false; };
  }, []);

  const unlock = async () => {
    setError("");
    setBusy(true);
    try {
      const token = await unlockWithBiometric();
      if (!token) return; // cancelled, or not recognised: the password is right there
      await signInWithToken(token);
      success();
    } catch (e: any) {
      fail();
      // Nothing kept any more (or nothing to open it with): the password it is.
      if (!(await biometricUser())) setLocked(null);
      setError(e?.message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const go = async () => {
    setError("");
    setBusy(true);
    const who = username.trim();
    try {
      await signIn(who, password);
      // Signed in: the lock for next time, then notifications — the phone's
      // own dialogs, once each (auth/welcome). Not awaited: the screen is
      // already going.
      welcome(who);
    } catch (e: any) {
      setError(e?.message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const fill = t.dark ? t.surface3 : t.surface2;

  return (
    <AuthFrame title="Welcome back" sub="Sign in to KaamKoRecord — PLU lookup and timesheets." foot="New here?" link="Create an account" linkHref="/(auth)/register">
      <Field label="Username">
        <Input autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} textContentType="username" autoComplete="username" testID="username" />
      </Field>
      {/* The password box: show/hide at the start, the phone's lock at the end. */}
      <Field label="Password" error={error || undefined} help={locked && kind ? `The ${biometricName(kind)} button signs you in as ${locked}.` : undefined}>
        <View ref={boxRef} style={[styles.box, { backgroundColor: fill }]}>
          <Pressable onPress={() => { tick(); setShown((v) => !v); }} hitSlop={6} accessibilityRole="button" accessibilityLabel={shown ? "Hide password" : "Show password"} testID="password-eye" style={[styles.round, { backgroundColor: t.dark ? t.surface2 : t.surface }]}>
            <Ionicons name={shown ? "eye-off-outline" : "eye-outline"} size={19} color={t.text2} />
          </Pressable>
          <TextInput
            secureTextEntry={!shown}
            value={password}
            onChangeText={setPassword}
            onFocus={() => reveal(boxRef.current)}
            placeholder="Password"
            placeholderTextColor={t.muted}
            textContentType="password"
            autoComplete="current-password"
            autoCapitalize="none"
            onSubmitEditing={go}
            testID="password"
            style={[styles.boxInput, { color: t.text }]}
          />
          {locked && kind ? (
            <Pressable onPress={() => { tap("medium"); unlock(); }} disabled={busy} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Sign in with ${biometricName(kind)}`} testID="biometric-signin" style={({ pressed }) => [styles.round, { backgroundColor: t.brandSoft, opacity: pressed || busy ? 0.7 : 1 }]}>
              <BiometricIcon kind={kind} size={22} color={t.brand} />
            </Pressable>
          ) : null}
        </View>
      </Field>
      <Button title="Sign in" onPress={go} busy={busy} disabled={!username || !password} />
      {/* No self-service reset: nobody can be emailed a link (apps/accounts/passwords.py). */}
      <Text style={{ color: t.muted, fontSize: 13, textAlign: "center" }}>
        Forgotten your password? Ask whoever looks after KaamKoRecord for a reset link.
      </Text>
      {Platform.OS !== "web" && kind && !locked ? (
        <Text style={{ color: t.muted, fontSize: 13, textAlign: "center" }}>After you sign in, you can use {biometricName(kind)} next time.</Text>
      ) : null}
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: sp[2], minHeight: 52, paddingHorizontal: 8, borderRadius: radius.md },
  boxInput: { flex: 1, minWidth: 0, fontSize: 16, height: 48 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
