/**
 * The way out for good (templates/accounts/delete.html): what goes, then
 * the password, then the button — in that order, so nobody reaches the
 * button without passing the list.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { me as api } from "@/api";
import { useSession } from "@/auth/session";
import { Button, Card, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { fail, warn } from "@/ui/haptics";
import { sp, useTheme } from "@/ui/theme";

const GOES = [
  "Your profile — name, contact details and photo",
  "Every shift, break, workplace and payment you recorded",
  "Your notices, comments, reactions and stories",
  "Your friends, and any requests either way",
  "The phones registered for notifications",
];

export default function DeleteAccount() {
  const t = useTheme();
  const { signOut } = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setError("");
    setBusy(true);
    try {
      warn();
      await api.deleteAccount(password);
      // The server has already forgotten us; this forgets the phone's side.
      await signOut();
    } catch (e: any) {
      fail();
      setError(e?.message || "That couldn't be done.");
      setBusy(false);
    }
  };

  return (
    <Screen back backLabel="Profile">
      <Page>
        <PageTitle sub="This cannot be undone.">Delete your account?</PageTitle>
        <Card style={{ gap: sp[3] }}>
          <Text style={[styles.label, { color: t.muted }]}>WHAT GOES WITH IT</Text>
          {GOES.map((line) => (
            <View key={line} style={styles.line}>
              <Ionicons name="remove-circle-outline" size={18} color={t.danger} />
              <Text style={{ color: t.text, fontSize: 15, lineHeight: 21, flex: 1 }}>{line}</Text>
            </View>
          ))}
          <Text style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>
            Where you commented on someone else's notice, they keep the notification they were sent at the time — with no name on it. Nothing else of yours remains.
          </Text>
        </Card>
        <Card style={{ gap: sp[4] }}>
          <Field label="Your password, to be sure" error={error}>
            <Input secureTextEntry value={password} onChangeText={setPassword} textContentType="password" autoComplete="current-password" testID="delete-password" />
          </Field>
          <Button title="Delete my account" icon="trash-outline" kind="danger" onPress={go} busy={busy} disabled={!password} testID="delete-confirm" />
        </Card>
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.72 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: sp[2] },
});
