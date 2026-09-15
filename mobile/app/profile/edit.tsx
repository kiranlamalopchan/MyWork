/** The words about you, and your photo. */
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { me as api } from "@/api";
import type { FilePart } from "@/api/client";
import { useSession } from "@/auth/session";
import { Avatar, Button, Card, Input, Screen, Sub } from "@/ui";
import { notify } from "@/ui/confirm";
import { goBack } from "@/nav/paths";
import { sp, useTheme } from "@/ui/theme";

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
      goBack();
    } catch (e: any) {
      setError(e?.message || "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  };

  const changePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const name = asset.fileName || "photo.jpg", type = asset.mimeType || "image/jpeg";
    try {
      const file: FilePart = Platform.OS === "web"
        ? (new File([await (await fetch(asset.uri)).blob()], name, { type }) as unknown as FilePart)
        : { uri: asset.uri, name, type };
      setMe(await api.setPhoto(file));
    } catch (e: any) {
      notify("Couldn't use that photo", e?.message || "");
    }
  };

  const setState = async (state: string) => setMe(await api.setHolidayState(state));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: sp[4], gap: sp[3] }} keyboardShouldPersistTaps="handled">
        <Card style={{ alignItems: "center", gap: sp[3] }}>
          <Avatar person={me} size={96} live={false} />
          <View style={{ flexDirection: "row", gap: sp[2] }}>
            <Button title="Change photo" kind="plain" icon="image-outline" onPress={changePhoto} />
            {me.photo ? <Button title="Remove" kind="danger" onPress={async () => setMe(await api.clearPhoto())} /> : null}
          </View>
          <Sub>Your letter and colour come from your username either way.</Sub>
        </Card>
        <Card style={{ gap: sp[3] }}>
          <Input placeholder={`Display name (${me.username})`} value={display} onChangeText={setDisplay} maxLength={40} />
          <Input placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Input placeholder="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Input placeholder="Address" value={address} onChangeText={setAddress} />
          {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
          <Button title="Save" onPress={save} busy={busy} />
        </Card>
        <Card style={{ gap: sp[2] }}>
          <Text style={{ color: t.text, fontWeight: "700" }}>Public holidays for</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }}>
            {STATES.map((s) => (
              <Pressable key={s} onPress={() => setState(s)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: me.holiday_state === s ? t.brand : t.surface2 }}>
                <Text style={{ color: me.holiday_state === s ? t.brandInk : t.text, fontWeight: "700" }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
