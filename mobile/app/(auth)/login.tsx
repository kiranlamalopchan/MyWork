import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { Button, Input, Screen, Sub, Title } from "@/ui";
import { sp, useTheme } from "@/ui/theme";

export default function Login() {
  const { signIn } = useSession();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setError("");
    setBusy(true);
    try {
      await signIn(username.trim(), password);
    } catch (e: any) {
      setError(e?.message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + sp[6] }]} keyboardShouldPersistTaps="handled">
          <View style={[styles.mark, { backgroundColor: t.brand }]}>
            <Text style={{ color: t.brandInk, fontSize: 30, fontWeight: "800" }}>M</Text>
          </View>
          <Title>MyWork</Title>
          <Sub>PLU lookup, timesheets and the notice board — in your pocket.</Sub>
          <View style={{ height: sp[5] }} />
          <Input placeholder="Username" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} textContentType="username" testID="username" />
          <View style={{ height: sp[3] }} />
          <Input placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} textContentType="password" onSubmitEditing={go} testID="password" />
          {error ? <Text style={{ color: t.danger, marginTop: sp[3] }}>{error}</Text> : null}
          <View style={{ height: sp[4] }} />
          <Button title="Sign in" onPress={go} busy={busy} disabled={!username || !password} />
          <View style={{ height: sp[4] }} />
          <Link href="/(auth)/register" style={{ color: t.brand, fontWeight: "600", textAlign: "center" }}>New here? Create an account</Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: sp[5], maxWidth: 480, width: "100%", alignSelf: "center" },
  mark: { width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: sp[4] },
});
