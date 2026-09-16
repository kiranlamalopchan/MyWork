/** A new notice (templates/noticeboard/notice_form.html), or a change to one of yours. */
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { board, useBoardChanged, usePostNotice } from "@/api";
import { goBack } from "@/nav/paths";
import { Button, Card, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { sp, useTheme } from "@/ui/theme";
import { fail, success } from "@/ui/haptics";

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
      success();
      goBack();
    } catch (e: any) {
      fail();
      setError(e?.message || "That couldn't be posted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back backLabel="Notice board">
      <Page>
        <PageTitle sub={editing ? "Everyone who reads the board sees the change." : "Everyone signed in will see this on the board."}>{editing ? "Edit notice" : "New notice"}</PageTitle>
        <Card>
          <Field label="Notice" error={error || undefined}>
            <Input
              placeholder="Share something with everyone…"
              value={body}
              onChangeText={setBody}
              multiline
              autoFocus
              maxLength={MAX}
              style={{ minHeight: 140, textAlignVertical: "top" }}
              testID="notice-body"
            />
          </Field>
          <Text style={{ color: t.muted, fontSize: 12, textAlign: "right", marginTop: sp[2] }}>{body.length}/{MAX}</Text>
        </Card>
        <View style={{ gap: sp[3] }}>
          <Button title={editing ? "Save changes" : "Post notice"} onPress={go} busy={busy} disabled={!body.trim()} testID="post-notice" />
          <Button title="Cancel" kind="plain" onPress={goBack} />
        </View>
      </Page>
    </Screen>
  );
}
