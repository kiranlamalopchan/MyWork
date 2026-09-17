/**
 * The line under the sign-in card that says which server the app talks to,
 * and lets it be changed without a new build: the laptop while developing,
 * the site once it is deployed. Kept on the phone.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { defaultServer, isCustomServer, loadServer, serverUrl, setServer } from "@/api/server";

import { Button, Input } from "./index";
import { radius, sp, useTheme } from "./theme";

export function ServerPicker() {
  const t = useTheme();
  const [current, setCurrent] = useState(serverUrl());
  const [custom, setCustom] = useState(isCustomServer());
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  useEffect(() => { loadServer().then((url) => { setCurrent(url); setCustom(isCustomServer()); }); }, []);

  const save = async () => {
    await setServer(typed.trim() || null);
    setCurrent(serverUrl()); setCustom(isCustomServer()); setOpen(false);
  };
  const reset = async () => {
    await setServer(null);
    setCurrent(serverUrl()); setCustom(false); setTyped(""); setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => { setTyped(custom ? current : ""); setOpen((v) => !v); }} style={styles.line} testID="server-toggle" accessibilityLabel={`Server: ${current}. Change`}>
        <Ionicons name="server-outline" size={14} color={t.muted} />
        <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{current.replace(/^https?:\/\//, "")}</Text>
        <Text style={{ color: t.brand, fontSize: 13, fontWeight: "700" }}>{open ? "Close" : "Change"}</Text>
      </Pressable>
      {open ? (
        <View style={[styles.panel, { backgroundColor: t.surface, borderColor: t.dark ? t.line : "transparent" }]}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 15 }}>Server address</Text>
          <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>
            Where MeroKaam is running: the site's address, or your laptop's on the same Wi-Fi while developing (for example 192.168.0.11:8000). Leave it empty for this build's own: {defaultServer().replace(/^https?:\/\//, "")}.
          </Text>
          <Input value={typed} onChangeText={setTyped} placeholder="https://example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" testID="server-url" />
          <View style={{ flexDirection: "row", gap: sp[2] }}>
            {custom ? <Button title="Use default" kind="plain" size="sm" onPress={reset} /> : null}
            <View style={{ flex: 1 }} />
            <Button title="Save" size="sm" onPress={save} testID="server-save" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", gap: sp[3], marginTop: sp[3] },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 4 },
  panel: { gap: sp[3], padding: sp[4], borderRadius: radius.lg, borderWidth: 1 },
});
