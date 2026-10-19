import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "@/api";
import { Button, Field, Input } from "@/ui";
import { AuthFrame } from "@/ui/AuthFrame";
import { sp, useTheme } from "@/ui/theme";

export default function ForgotPassword() {
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const send = async () => {
    const address = email.trim();
    if (!address || sending.current) return;
    sending.current = true;
    setBusy(true); setError("");
    try {
      await auth.requestPasswordReset(address);
      setSent(true);
    } catch (e: any) {
      setError(e?.fields?.email?.[0] || e?.message || "Couldn't request a reset link. Please try again.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return <AuthFrame title={sent ? "Check your email" : "Forgot password?"}
    sub={sent ? "If an account uses that email, a password reset link will arrive shortly." : "Enter the email saved on your account. We'll send you a link to choose a new password."}
    foot="Remember your password?" link="Back to sign in" linkHref="/(auth)/login">
    {sent ? <View style={{ gap: sp[4] }}>
      <Ionicons name="mail-open-outline" size={36} color={t.brand} style={{ alignSelf: "center" }} />
      <Text style={{ color: t.text, fontSize: 15, lineHeight: 23 }}>Open the link in your email. It works once and expires after one hour.</Text>
      <Text style={{ color: t.muted, fontSize: 14, lineHeight: 21 }}>Check your spam folder too. If nothing arrives, check the email address or ask an admin for help.</Text>
      <Button title="Try another email" kind="plain" onPress={() => { setSent(false); setError(""); }} />
    </View> : <>
      <Field label="Email address" error={error || undefined}>
        <Input accessibilityLabel="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
          maxLength={254} editable={!busy} returnKeyType="send" onSubmitEditing={send} testID="reset-email" />
      </Field>
      <Button title="Send reset link" onPress={send} busy={busy} disabled={!email.trim() || busy} testID="request-reset" />
      <Text style={{ color: t.muted, fontSize: 13, lineHeight: 20, textAlign: "center" }}>No email on your account? Ask an admin for a reset link.</Text>
    </>}
  </AuthFrame>;
}
