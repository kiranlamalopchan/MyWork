import React, { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { board, useBoardChanged, usePostNotice } from "@/api";
import { Button, Input, Screen, Sub } from "@/ui";
import { goBack } from "@/nav/paths";
import { sp, useTheme } from "@/ui/theme";

const MAX = 600;

export default function Compose() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id?: string; body?: string }>();
  const editing = params.id ? Number(params.id) : null;
  const [body, setBody] = useState(params.body || "");
  const [error, setError] = useState("");
  const post = usePostNotice();
  const changed = useBoardChanged();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setError("");
    setBusy(true);
    try {
      if (editing) {
        await board.edit(editing, body);
        changed(editing);
      } else {
        await post.mutateAsync(body);
      }
      goBack();
    } catch (e: any) {
      setError(e?.message || "That couldn't be posted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ padding: sp[4] }}>
      <Input
        placeholder="What does everyone need to know?"
        value={body}
        onChangeText={setBody}
        multiline
        autoFocus
        maxLength={MAX}
        style={{ minHeight: 140, textAlignVertical: "top" }}
        testID="notice-body"
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: sp[2] }}>
        <Sub>Everyone signed in will see it.</Sub>
        <Sub>{body.length}/{MAX}</Sub>
      </View>
      {error ? <Text style={{ color: t.danger, marginTop: sp[2] }}>{error}</Text> : null}
      <View style={{ height: sp[4] }} />
      <Button title={editing ? "Save" : "Post to the board"} onPress={go} busy={busy} disabled={!body.trim()} />
    </Screen>
  );
}
