/** The words about you (templates/accounts/profile_form.html), and which state's holidays you keep. */
import React, { useState } from "react";
import { Text, View } from "react-native";

import { me as api } from "@/api";
import { useSession } from "@/auth/session";
import { Button, Card, Chip, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { goBack } from "@/nav/paths";
import { sp, useTheme } from "@/ui/theme";
import { fail, success } from "@/ui/haptics";

const STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

export default function EditProfile() {
  const t = useTheme();
  const { me, setMe } = useSession();
  const [display, setDisplay] = useState(me?.display_name || "");
  const [email, setEmail] = useState(me?.email || "");
  const [phone, setPhone] = useState(me?.phone || "");
  const [address, setAddress] = useState(me?.address || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const save = async () => {
    setError("");
    setBusy(true);
    try {
      setMe(await api.update({ display_name: display, email, phone, address }));
      success();
      goBack();
    } catch (e: any) {
      fail();
      setError(e?.message || "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  };
  const setState = async (state: string) => setMe(await api.setHolidayState(state));

  return (
    <Screen back backLabel="Profile">
      <Page>
        <PageTitle>Edit profile</PageTitle>
        <Card style={{ gap: sp[4] }}>
          <Field label="Display name" help={`How you appear on the board. Blank means ${me.username}.`}>
            <Input placeholder="e.g. Kiran L." value={display} onChangeText={setDisplay} maxLength={40} autoComplete="name" testID="display-name" />
          </Field>
          <Field label="Email">
            <Input placeholder="you@example.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          </Field>
          <Field label="Phone">
            <Input placeholder="e.g. 0412 345 678" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
          </Field>
          <Field label="Address">
            <Input placeholder="Street, suburb" value={address} onChangeText={setAddress} autoComplete="street-address" />
          </Field>
          {error ? <Text style={{ color: t.danger, fontSize: 13 }}>{error}</Text> : null}
          <View style={{ gap: sp[2] }}>
            <Button title="Save changes" onPress={save} busy={busy} testID="save-profile" />
            <Button title="Cancel" kind="plain" onPress={goBack} />
          </View>
        </Card>
        <Card style={{ gap: sp[3] }}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>Public holidays for</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }}>
            {STATES.map((s) => <Chip key={s} on={me.holiday_state === s} onPress={() => setState(s)}>{s}</Chip>)}
          </View>
        </Card>
      </Page>
    </Screen>
  );
}
