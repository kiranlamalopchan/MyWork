import React, { useState } from "react";

import { fieldErrors } from "@/api/client";
import { useSession } from "@/auth/session";
import { welcome } from "@/auth/welcome";
import { Button, Field, Input } from "@/ui";

import { AuthFrame } from "@/ui/AuthFrame";

export default function Register() {
  const { register } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setErrors({});
    if (password !== again) return setErrors({ again: "The two passwords don't match." });
    setBusy(true);
    try {
      const who = username.trim();
      await register(who, password);
      // A new account on this phone: the lock for next time, then
      // notifications, in the phone's own dialogs (auth/welcome).
      welcome(who);
    } catch (e: any) {
      // The one password is sent as both halves of the server's form, so
      // whichever half it complains about is about the box above.
      setErrors(fieldErrors(e, {
        username: "username",
        password1: "password",
        password2: "password",
      }, "again"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Create account" sub="One account for PLU lookup and timesheets." foot="Already have an account?" link="Sign in" linkHref="/(auth)/login" agree>
      <Field label="Username" error={errors.username}>
        <Input autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} textContentType="username" testID="username" />
      </Field>
      <Field label="Password" help="At least 8 characters, and not all numbers." error={errors.password}>
        <Input secureTextEntry value={password} onChangeText={setPassword} textContentType="newPassword" testID="password" />
      </Field>
      <Field label="Confirm password" error={errors.again}>
        <Input secureTextEntry value={again} onChangeText={setAgain} textContentType="newPassword" onSubmitEditing={go} testID="password2" />
      </Field>
      <Button title="Create account" onPress={go} busy={busy} disabled={!username || !password || !again} />
    </AuthFrame>
  );
}
