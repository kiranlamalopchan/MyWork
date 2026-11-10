import React, { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "@/auth/session";
import type { SocialProvider } from "@/auth/social";
import { welcome } from "@/auth/welcome";
import { useT } from "@/i18n";
import { ErrorBanner } from "./index";
import { useTheme } from "./theme";

export function SocialSignIn({ disabled = false, onBusyChange, purpose = "login" }: {
  disabled?: boolean; onBusyChange?: (busy: boolean) => void; purpose?: "login" | "link";
}) {
  const t = useTheme(), tr = useT();
  const { signInWithSocial, me } = useSession();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);
  const go = async (provider: SocialProvider) => {
    if (disabled || running.current) return;
    running.current = true;
    setError(null); setBusy(provider); onBusyChange?.(true);
    try {
      const who = await signInWithSocial(provider, purpose);
      if (who && purpose === "login") welcome(who.username);
    } catch (failure) { setError(failure); }
    finally { running.current = false; setBusy(null); onBusyChange?.(false); }
  };
  return <View style={{ gap: 12 }}>
    {purpose === "login" ? <View style={styles.divider}>
      <View style={[styles.rule, { backgroundColor: t.line }]} />
      <Text style={{ color: t.muted, fontSize: 13 }}>{tr("or")}</Text>
      <View style={[styles.rule, { backgroundColor: t.line }]} />
    </View> : null}
    {(["google", "apple"] as const).map(provider => {
      const linked = purpose === "link" && me?.social_providers?.includes(provider);
      const label = linked ? tr(provider === "google" ? "Google connected" : "Apple connected")
        : purpose === "link" ? tr(provider === "google" ? "Connect Google" : "Connect Apple")
        : tr(provider === "google" ? "Continue with Google" : "Continue with Apple");
      const blocked = disabled || !!busy || !!linked;
      const background = provider === "apple" ? (t.dark ? "#ffffff" : "#000000") : t.surface;
      const foreground = provider === "apple" ? (t.dark ? "#000000" : "#ffffff") : t.text;
      return <Pressable key={provider} accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ disabled: blocked, busy: busy === provider }} disabled={blocked}
        testID={`social-${provider}`} onPress={() => { void go(provider); }}
        style={({ pressed }) => [styles.button, { backgroundColor: background, borderColor: t.line, opacity: blocked && busy !== provider ? 0.5 : pressed ? 0.75 : 1 }]}>
        {busy === provider ? <ActivityIndicator color={foreground} /> : provider === "apple"
          ? <Ionicons name="logo-apple" size={22} color={foreground} /> : <GoogleMark />}
        <Text style={{ color: foreground, fontSize: 16, fontWeight: "600" }}>{label}</Text>
        {linked ? <Ionicons name="checkmark" size={18} color={foreground} /> : null}
      </Pressable>;
    })}
    {error ? <ErrorBanner error={error} /> : null}
  </View>;
}

function GoogleMark() {
  return <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36Z" />
    <Path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.9.6-2.04.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z" />
    <Path fill="#FBBC05" d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z" />
    <Path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.86-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z" />
  </Svg>;
}
const styles = StyleSheet.create({
  button: { minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 12 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
});
