import React, { useState } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { festivals, type FestivalSettings } from "@/api/festivals";
import type { FilePart } from "@/api/client";
import { useSession } from "@/auth/session";
import { Button, Card, Empty, ErrorBanner, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { FestivalBanner } from "@/ui/FestivalBanner";
import { Select } from "@/ui/Select";
import { SkeletonRows } from "@/ui/Skeleton";
import { native } from "@/ui/native";
import { sp, useTheme } from "@/ui/theme";

export default function FestivalSettingsPage() {
  const { me } = useSession();
  const allowed = !!me?.can_manage_festival;
  const query = useQuery({ queryKey: ["festival-settings", me?.username], queryFn: festivals.settings, enabled: allowed, retry: false });
  return <Screen back backLabel="Profile"><Page>
    <PageTitle sub="Manage the shared banner on everyone's Home screen.">Festival banner</PageTitle>
    {!allowed ? <Empty icon="shield-checkmark-outline" title="Administrator access required" sub="Only authorised administrators can manage the shared banner." /> : <>
      {query.isLoading ? <SkeletonRows count={3} /> : null}
      {query.error ? <ErrorBanner error={query.error} onRetry={query.refetch} /> : null}
      {query.data && !query.error ? <Editor data={query.data} username={me!.username} /> : null}
    </>}
  </Page></Screen>;
}

function Editor({ data, username }: { data: FestivalSettings; username: string }) {
  const t = useTheme(), client = useQueryClient();
  const [theme, setTheme] = useState(data.theme), [greeting, setGreeting] = useState(data.greeting), [description, setDescription] = useState(data.description);
  const [image, setImage] = useState<{ uri: string; file: FilePart } | null>(null);
  const [remove, setRemove] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState("");
  const manual = theme !== "auto" && theme !== "off";
  const base = data.choices.find(choice => choice.value === theme)?.preview;
  const preview = base && manual ? { ...base, greeting: greeting.trim() || base.greeting, description: description.trim() || base.description, image_url: image?.uri || (!remove && data.banner_url) || base.image_url } : base;
  const pick = async () => {
    setError(""); setSaved(false);
    try {
      const picker = native<typeof import("expo-image-picker")>(() => require("expo-image-picker"));
      const result = await picker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [3, 1], quality: .9 });
      if (result.canceled) return;
      const asset = result.assets[0], name = asset.fileName || "festival-banner.jpg", type = asset.mimeType || "image/jpeg";
      if (asset.fileSize && asset.fileSize > 8 * 1024 * 1024) { setError("Choose a banner image smaller than 8 MB."); return; }
      const file: FilePart = { uri: asset.uri, name, type };
      setImage({ uri: asset.uri, file }); setRemove(false);
    } catch (e: any) { setError(e?.message || "That image couldn't be selected."); }
  };
  const save = async () => {
    setBusy(true); setError(""); setSaved(false);
    try {
      const result = await festivals.save({ theme, greeting, description, remove_banner: remove }, image?.file);
      client.setQueryData(["festival-settings", username], result);
      await client.invalidateQueries({ queryKey: ["home"] });
      setGreeting(result.greeting); setDescription(result.description); setImage(null); setRemove(false); setSaved(true);
    } catch (e: any) { setError(e?.message || "The banner couldn't be saved."); }
    finally { setBusy(false); }
  };
  const changed = () => setSaved(false);
  return <>
    <Card style={{ gap: sp[4] }}>
      <Field label="Festival" help="Automatic follows festival dates. Off hides the banner."><View pointerEvents={busy ? "none" : "auto"}><Select label="Festival" value={theme} options={data.choices.map(choice => ({ value: choice.value, label: choice.label }))} onChange={value => { setTheme(value); changed(); }} /></View></Field>
      {manual ? <>
        <Field label="Greeting" help="Leave blank for the standard festival greeting."><Input accessibilityLabel="Greeting" value={greeting} onChangeText={value => { setGreeting(value); changed(); }} maxLength={120} editable={!busy} /></Field>
        <Field label="Description" help="Leave blank for the standard festival description."><Input accessibilityLabel="Description" value={description} onChangeText={value => { setDescription(value); changed(); }} maxLength={600} multiline editable={!busy} /></Field>
        <Button title={image || data.banner_url && !remove ? "Change banner image" : "Choose banner image"} icon="image-outline" kind="plain" disabled={busy} onPress={pick} />
        {image || data.banner_url && !remove ? <Button title="Use standard artwork" kind="plain" disabled={busy} onPress={() => { setImage(null); setRemove(true); changed(); }} /> : null}
        <Text style={{ color: t.muted, fontSize: 12 }}>Choose a wide image, up to 8 MB.</Text>
      </> : null}
    </Card>
    <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>Preview</Text>
    {preview ? <FestivalBanner festival={preview} /> : <Card><Text style={{ color: t.muted }}>{theme === "off" ? "The festival banner will be hidden." : "No festival banner is scheduled for today."}</Text></Card>}
    <Text style={{ color: t.muted }}>Saving updates Home for everyone.</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: t.danger }}>{error}</Text> : null}
    {saved ? <Text accessibilityLiveRegion="polite" style={{ color: t.brandStrong }}>Festival banner saved.</Text> : null}
    <Button title="Save banner" icon="checkmark-outline" onPress={save} busy={busy} disabled={busy} />
  </>;
}
