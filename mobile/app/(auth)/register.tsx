import React, { useState } from "react";

import { ApiError } from "@/api";
import { useSession } from "@/auth/session";
import { welcome } from "@/auth/welcome";
import { Button, Field, Input } from "@/ui";

import { AuthFrame } from "@/ui/AuthFrame";

export default function Register() {
  const { register } = useSession();
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
      const who = username.trim();
      await register(who, password);
      // A new account on this phone: the lock for next time, then
      // notifications, in the phone's own dialogs (auth/welcome).
      welcome(who);
    } catch (e: any) {
      const fields = e instanceof ApiError ? Object.values(e.fields).flat() : [];
      setError(String(fields[0] || e?.message || "That didn't work."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Create account" sub="One account for PLU lookup and timesheets." foot="Already have an account?" link="Sign in" linkHref="/(auth)/login" agree>
      <Field label="Username">
        <Input autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} textContentType="username" testID="username" />
      </Field>
      <Field label="Password" help="At least 8 characters, and not all numbers.">
        <Input secureTextEntry value={password} onChangeText={setPassword} textContentType="newPassword" testID="password" />
      </Field>
      <Field label="Confirm password" error={error || undefined}>
        <Input secureTextEntry value={again} onChangeText={setAgain} textContentType="newPassword" onSubmitEditing={go} testID="password2" />
      </Field>
      <Button title="Create account" onPress={go} busy={busy} disabled={!username || !password || !again} />
    </AuthFrame>
  );
}
