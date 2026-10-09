import React, { useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { catalogue, useCatalogueChanged, useCatalogueIdle, type CatalogueMapping, type CataloguePreview } from "@/api/catalogue";
import type { FilePart } from "@/api/client";
import { Button, Card, Chip, Field, Page, PageTitle, Screen } from "@/ui";
import { Select } from "@/ui/Select";
import { native } from "@/ui/native";
import { sp, useTheme } from "@/ui/theme";
import { confirm, tell } from "@/ui/confirm";

export default function ImportItems() {
  const t = useTheme();
  const router = useRouter();
  const changed = useCatalogueChanged();
  const current = useCatalogueIdle();
  const [preview, setPreview] = useState<CataloguePreview | null>(null);
  const [mapping, setMapping] = useState<CatalogueMapping | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const pick = async () => {
    setError("");
    try {
      const DocumentPicker = native<typeof import("expo-document-picker")>(() => require("expo-document-picker"));
      const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const file: FilePart = Platform.OS === "web"
        ? ((asset as any).file || new File([await (await fetch(asset.uri)).blob()], asset.name, { type: "text/csv" })) as unknown as FilePart
        : { uri: asset.uri, name: asset.name, type: asset.mimeType || "text/csv" };
      setBusy(true); setProgress(0);
      const result = await catalogue.preview(file, setProgress);
      setPreview(result); setMapping(result.defaults); setReview(false);
    } catch (e: any) { setError(e?.message || "The CSV couldn't be read."); }
    finally { setBusy(false); setProgress(null); }
  };
  const save = async () => {
    if (!preview || !mapping) return;
    setBusy(true); setError("");
    try {
      const result = await catalogue.save(preview.upload_id, mapping);
      changed();
      tell("Catalogue saved", result.message);
      router.replace({ pathname: "/plu", params: { catalogue: String(result.catalogue_id) } });
    } catch (e: any) { setError(e?.message || "The catalogue couldn't be saved."); }
    finally { setBusy(false); }
  };
  const target = current.data?.catalogues.find((c) => c.id === mapping?.catalogue_id);
  const submit = () => {
    if (target) confirm(`Replace ${target.name}?`, `This replaces the ${target.count} items in ${target.name}. Your other catalogues are kept.`, "Replace", save);
    else save();
  };
  const patch = (next: Partial<CatalogueMapping>) => setMapping((old) => old ? { ...old, ...next } : old);
  const options = preview?.headers.map((h) => ({ value: h, label: h })) ?? [];
  const optional = [{ value: "", label: "None" }, ...options];
  return (
    <Screen back backLabel="Items">
      <Page>
        <PageTitle sub="Your data is private to your account. Choose your file's headings and the columns you want to search.">Upload your items</PageTitle>
        <View style={{ flexDirection: "row", gap: sp[3] }}>{["1. File", "2. Headings", "3. Review"].map((step, i) => <Text key={step} style={{ flex: 1, fontSize: 13, fontWeight: "700", color: i === (review ? 2 : preview ? 1 : 0) ? t.brandStrong : t.muted, borderBottomWidth: 3, borderBottomColor: i === (review ? 2 : preview ? 1 : 0) ? t.brand : t.line, paddingBottom: sp[3] }}>{step}</Text>)}</View>
        {error ? <Text accessibilityRole="alert" style={{ color: t.danger }}>{error}</Text> : null}
        <Button title={busy && progress !== null ? `Uploading ${Math.round(progress * 100)}%…` : preview ? "Choose another CSV" : "Choose a CSV"} icon="cloud-upload-outline" onPress={pick} disabled={busy} />
        <Text style={{ color: t.muted }}>Up to 10 MB and 20,000 items. Export spreadsheets as CSV first.</Text>
        {preview && mapping ? <>
          {!review ? <><Card style={{ gap: sp[3] }}>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{preview.count.toLocaleString()} items found</Text>
            <Text style={{ color: t.muted }}>Preview of the first five rows. All columns are kept on each item's detail page.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ flexDirection: "row" }}>{preview.headers.map((heading) => <View key={heading} style={{ width: 160, padding: sp[2], gap: sp[2] }}>
                <Text style={{ color: t.brand, fontWeight: "700" }}>{heading}</Text>
                {preview.sample.map((row, index) => <Text key={index} numberOfLines={2} style={{ color: t.text, minHeight: 42 }}>{row[heading] || "—"}</Text>)}
              </View>)}</View>
            </ScrollView>
          </Card>
          <Card style={{ gap: sp[4] }}>
            <Field label="Save to" help="A new catalogue keeps your other uploads."><Select value={mapping.catalogue_id ? String(mapping.catalogue_id) : ""} label="Save catalogue to" options={[{ value: "", label: "Create a new catalogue" }, ...(current.data?.catalogues ?? []).map((c) => ({ value: String(c.id), label: `Replace ${c.name} (${c.count} items)` }))]} onChange={(value) => patch({ catalogue_id: value ? Number(value) : undefined, name: value ? current.data?.catalogues.find((c) => c.id === Number(value))?.name || mapping.name : preview.defaults.name })} /></Field>
            <Field label="Catalogue name"><TextInput value={mapping.name} onChangeText={(name) => patch({ name })} maxLength={100} style={{ color: t.text, fontSize: 16, padding: sp[3] }} editable={!busy} /></Field>
            <Field label="Title column (required)"><Select value={mapping.title_column} options={options} onChange={(title_column) => patch({ title_column })} label="Title column" /></Field>
            <Field label="Description column (optional)"><Select value={mapping.description_column} options={optional} onChange={(description_column) => patch({ description_column })} label="Description column" /></Field>
            <Field label="Code column (optional)" help="Use unique codes, or choose None. Letters and leading zeroes are kept."><Select value={mapping.code_column} options={optional} onChange={(code_column) => patch({ code_column })} label="Code column" /></Field>
            <Field label="Columns to search" help="Select at least one column."><View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }}>{preview.headers.map((h) => <Chip key={h} on={mapping.search_columns.includes(h)} onPress={() => patch({ search_columns: mapping.search_columns.includes(h) ? mapping.search_columns.filter((c) => c !== h) : [...mapping.search_columns, h] })}>{h}</Chip>)}</View></Field>
          </Card>
          </> : <Card style={{ gap: sp[3] }}><Text style={{ color: t.text, fontWeight: "700", fontSize: 20 }}>{mapping.name}</Text><Text style={{ color: t.muted }}>{preview.count.toLocaleString()} items · {target ? `Replace ${target.name}` : "New private catalogue"}</Text><Text style={{ color: t.text }}>Title: {mapping.title_column}{"\n"}Description: {mapping.description_column || "None"}{"\n"}Code: {mapping.code_column || "None"}{"\n"}Search: {mapping.search_columns.join(", ")}</Text><Text style={{ color: t.muted }}>All uploaded columns are kept. Your other catalogues stay available.</Text><Button title="Edit headings" kind="plain" onPress={() => setReview(false)} disabled={busy} /></Card>}
          {target ? <Text style={{ color: t.muted }}>Saving replaces only {target.name} ({target.count} items).</Text> : null}
          <Button title={review ? target ? `Replace ${target.name}` : "Save new catalogue" : "Review catalogue"} onPress={review ? submit : () => setReview(true)} busy={busy} disabled={busy || !mapping.search_columns.length || !mapping.name.trim()} />
        </> : null}
      </Page>
    </Screen>
  );
}
