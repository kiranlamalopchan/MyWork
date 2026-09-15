import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/api";
import { useSession } from "@/auth/session";
import { Button, Input, Screen, Sub, Title } from "@/ui";
import { sp, useTheme } from "@/ui/theme";

export default function Register() {
  const { register } = useSession();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setError("");
    if (password !== again) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      await register(username.trim(), password);
    } catch (e: any) {
      const fields = e instanceof ApiError ? Object.values(e.fields).flat() : [];
      setError(fields[0] || e?.message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + sp[6] }]} keyboardShouldPersistTaps="handled">
          <Title>Create an account</Title>
          <Sub>A username and a password — that's all MyWork asks.</Sub>
          <View style={{ height: sp[5] }} />
          <Input placeholder="Username" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} />
          <View style={{ height: sp[3] }} />
          <Input placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} textContentType="newPassword" />
          <View style={{ height: sp[3] }} />
          <Input placeholder="Password, again" secureTextEntry value={again} onChangeText={setAgain} onSubmitEditing={go} />
          {error ? <Text style={{ color: t.danger, marginTop: sp[3] }}>{error}</Text> : null}
          <View style={{ height: sp[4] }} />
          <Button title="Create account" onPress={go} busy={busy} disabled={!username || !password || !again} />
          <View style={{ height: sp[4] }} />
          <Link href="/(auth)/login" style={{ color: t.brand, fontWeight: "600", textAlign: "center" }}>Already have one? Sign in</Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: sp[5], maxWidth: 480, width: "100%", alignSelf: "center" },
});
