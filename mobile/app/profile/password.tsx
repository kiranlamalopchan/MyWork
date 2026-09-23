/**
 * Changing your password from the app (templates/accounts/password.html).
 *
 * One token covers every phone rather than one each, so the server retires
 * it with the old password and hands back a new one. That is kept here, and
 * put back behind the phone's own lock when that is how this person signs
 * in — otherwise the next Face ID would open with a token the server has
 * already forgotten.
 */
import React, { useState } from "react";
import { Text } from "react-native";

import { me as api } from "@/api";
import { fieldErrors } from "@/api/client";
import { armBiometric, biometricUser } from "@/auth/biometric";
import { setToken } from "@/auth/token";
import { goBack } from "@/nav/paths";
import { tell } from "@/ui/confirm";
import { Button, Card, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { fail } from "@/ui/haptics";
import { sp, useTheme } from "@/ui/theme";

export default function ChangePassword() {
  const t = useTheme();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  // Keyed by box: the server can refuse the old password, the new one, or
  // both at once, and each message belongs where it was typed.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setErrors({});
    setBusy(true);
    try {
      const { token } = await api.changePassword(current, next, again);
      await setToken(token);
      try {
        const who = await biometricUser();
        if (who) await armBiometric(who, token);
      } catch {
        /* the lock will simply ask for the password once more */
      }
      goBack();
      // Nothing on the screen behind says it worked, and a password that
      // silently did nothing is the one people try again.
      tell("Password changed", "Use the new one next time you sign in.");
    } catch (e: any) {
      fail();
      setErrors(fieldErrors(e, {
        old_password: "current",
        new_password1: "next",
        new_password2: "again",
      }, "again"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back backLabel="Profile">
      <Page>
        <PageTitle sub="You'll need the one you use now.">Change your password</PageTitle>
        <Card style={{ gap: sp[4] }}>
          <Field label="Your current password" error={errors.current}>
            <Input secureTextEntry value={current} onChangeText={setCurrent} textContentType="password" autoComplete="current-password" testID="password-current" />
          </Field>
          <Field label="New password" help="At least 8 characters, and not all numbers." error={errors.next}>
            <Input secureTextEntry value={next} onChangeText={setNext} textContentType="newPassword" autoComplete="new-password" testID="password-new" />
          </Field>
          <Field label="Confirm new password" error={errors.again}>
            <Input secureTextEntry value={again} onChangeText={setAgain} textContentType="newPassword" autoComplete="new-password" testID="password-again" />
          </Field>
          <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>
            Changing it signs KaamKoRecord out on any other phone you use.
          </Text>
          <Button title="Change password" icon="key-outline" onPress={go} busy={busy} disabled={!current || !next || !again} testID="password-save" />
        </Card>
      </Page>
    </Screen>
  );
}
