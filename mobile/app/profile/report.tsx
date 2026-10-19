import React, { useState } from "react";
import { Platform, Text } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { api, formWith, type FilePart } from "@/api/client";
import { goBack } from "@/nav/paths";
import { Button, Card, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { appVersion } from "@/ui/Version";
import { notify } from "@/ui/confirm";
import { usePrivateState } from "@/storage/private";
import { useTheme } from "@/ui/theme";
export default function ReportProblem() {
  const [description, setDescription, ready] = usePrivateState("problem-report-draft", "");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const t = useTheme();
  return <Screen back><Page><PageTitle sub="Tell the administrator what happened and what you expected. Your app version is included; passwords and authentication tokens are never attached.">Report a problem</PageTitle>
    <Card><Field label="What went wrong?" error={error || undefined}><Input value={description} onChangeText={setDescription} multiline maxLength={4000} style={{ minHeight: 160, textAlignVertical: "top" }} /></Field></Card>
    <Button title={photo ? "Change screenshot" : "Attach screenshot (optional)"} kind="plain" onPress={async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: .8 });
      if (!result.canceled) setPhoto(result.assets[0]);
    }} />
    {photo ? <><Text style={{ color: t.muted }}>{photo.fileName || "Screenshot attached"} — check that it contains only what you want to share.</Text><Button title="Remove screenshot" kind="ghost" onPress={() => setPhoto(null)} /></> : null}
    <Button title="Send report" busy={busy} disabled={!ready || !description.trim()} onPress={async () => {
      setBusy(true); setError("");
      try {
        let screenshot: FilePart | undefined;
        if (photo) {
          const name = photo.fileName || "screenshot.jpg", type = photo.mimeType || "image/jpeg";
          screenshot = { uri: photo.uri, name, type };
        }
        const version = appVersion();
        await api("support/reports/", { method: "POST", form: formWith({ description, screenshot, app_version: version.version, build: version.build, platform: Platform.OS }) });
        setDescription(""); notify("Report sent", "The administrator can review it in Django Admin."); goBack();
      } catch (failure: any) { setError(failure.message || "Couldn't send your report. Your text is saved on this device."); }
      finally { setBusy(false); }
    }} />
  </Page></Screen>;
}
