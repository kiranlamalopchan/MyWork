/**
 * Native catalogue search, kept to one thing: a single box that types its own
 * examples — real names and codes from the catalogue being searched — until
 * it is yours. Under it, one quiet line says where you are searching and how
 * much was found; the results are a plain list of code and description.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useCatalogueIdle, useCatalogueSearch, type CatalogueItem } from "@/api/catalogue";
import { Button, Card, Empty, ErrorBanner, Screen, Segments } from "@/ui";
import { tick } from "@/ui/haptics";
import { RevealProvider, useKeyboardScroll } from "@/ui/keyboard";
import { useLayout } from "@/ui/layout";
import { WithDepth } from "@/ui/depth";
import { TypedPlaceholder } from "@/ui/TypedPlaceholder";
import { Select } from "@/ui/Select";
import { usePrivateState } from "@/storage/private";
import { PhotoSearch } from "@/ui/PhotoSearch";
import { SkeletonRows } from "@/ui/Skeleton";
import { useDeleteCatalogue } from "@/ui/useDeleteCatalogue";
import { ActionMenu } from "@/ui/ActionMenu";
import { radius, sp, useTheme } from "@/ui/theme";

export default function Plu() {
  const t = useTheme();
  const layout = useLayout();
  const router = useRouter();
  const deletion = useDeleteCatalogue();
  const params = useLocalSearchParams<{ catalogue?: string; view?: string }>();
  const catalogueId = params.catalogue ? Number(params.catalogue) : undefined;
  const [mode, setMode] = usePrivateState<"search" | "photo">("items-mode", "search");
  const [typed, setTyped] = usePrivateState(`items-query:${catalogueId || "default"}`, "");
  const [pagination, setPagination] = useState<{ q: string; catalogueId?: number; page: number }>({ q: "", page: 1 });
  const [q, setQ] = useState("");
  const box = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const list = useRef<FlatList<CatalogueItem>>(null);
  const keyboard = useKeyboardScroll(useCallback((y: number) => list.current?.scrollToOffset({ offset: y, animated: true }), []));

  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(id);
  }, [typed]);

  const page = pagination.q === q && pagination.catalogueId === catalogueId ? pagination.page : 1;
  const search = useCatalogueSearch(q, catalogueId, page);
  const idleQuery = useCatalogueIdle(catalogueId);
  const idleData = idleQuery.data;
  const hasPlu = ["plu", "plu_no"].includes(idleData?.catalogue?.code_column.toLowerCase() || "");
  const idle = !typed.trim();
  const waiting = !idle && (typed.trim() !== q || search.isLoading);
  const rows = search.data?.results ?? [];
  const count = search.data?.count ?? 0;
  const total = idleData?.total ?? 0;
  const phrases = useMemo(() => examples(idleData?.samples ?? []), [idleData?.samples]);

  const goToPage = (next: number) => {
    tick();
    setPagination({ q, catalogueId, page: next });
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };
  const changeSearch = (value: string) => { setTyped(value); setPagination({ q: "", page: 1 }); };
  const upload = () => router.push("/items/import");
  const photo = () => { tick(); setMode("photo"); };
  const chooseCatalogue = (value: string) => { changeSearch(""); setQ(""); router.setParams({ catalogue: value }); };

  if (mode === "photo") return (
    <Screen>
      <WithDepth>{(under) => <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} {...under.scroll} onScroll={under.onScroll} scrollEventThrottle={16}
        contentContainerStyle={[layout.column, { paddingTop: sp[4] + under.padTop, gap: sp[4], paddingBottom: layout.bottom + sp[6] }]}>
        <View style={styles.photoHead}>
          <Pressable onPress={() => { tick(); setMode("search"); }} accessibilityRole="button" accessibilityLabel="Back to search"
            style={({ pressed }) => [styles.back, { backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name="chevron-back" size={18} color={t.text} />
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 15 }}>Search</Text>
          </Pressable>
          <Text style={[styles.photoTitle, { color: t.text }]}>Photo search</Text>
        </View>
        <PhotoSearch key={idleData?.catalogue?.id} catalogueId={idleData?.catalogue?.id} />
      </ScrollView>}</WithDepth>
    </Screen>
  );

  const catalogues = params.view === "catalogues";
  // Inside each list rather than above it, so it scrolls up under the floating bar with the rest.
  const workspaceHeader = <View style={styles.workspaceHeader} testID="catalogue-workspace-header">
    <Segments value={catalogues ? "catalogues" : "search"} onChange={view => { Keyboard.dismiss(); router.setParams({ view }); }} options={[{ value: "search", label: "Search" }, { value: "catalogues", label: "My catalogues" }]} />
    <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">{catalogues ? "Your catalogues" : "Search"}</Text>
  </View>;

  const catalogueContent = <View style={styles.catalogueContent} testID="catalogue-list">
    <Button title="Upload a new catalogue" icon="add" onPress={upload} />
    {idleQuery.error ? <ErrorBanner error={idleQuery.error} onRetry={idleQuery.refetch} /> : null}
    {deletion.error ? <Text accessibilityRole="alert" style={{ color: t.danger }}>{deletion.error}</Text> : null}
    {idleQuery.isLoading ? <SkeletonRows count={3} /> : null}
    {idleData?.catalogues.map(saved => <Card key={saved.id}>
      <View style={styles.catalogueRow}>
        <Ionicons name="folder-outline" size={24} color={t.brandStrong} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 18 }}>{saved.name}</Text>
          <Text style={{ color: t.muted, marginTop: sp[1] }}>{saved.count.toLocaleString()} private items</Text>
        </View>
        <ActionMenu label={`Actions for ${saved.name}`} disabled={deletion.busyId !== null} actions={[
          { label: "Edit", accessibilityLabel: `Edit ${saved.name}`, icon: "create-outline", onPress: () => router.push(`/items/catalogue/${saved.id}`) },
          { label: "Delete", accessibilityLabel: `Delete ${saved.name}`, icon: "trash-outline", destructive: true, onPress: () => deletion.remove(saved.id, saved.name, saved.count) },
        ]} />
      </View>
    </Card>)}
    {idleData && !idleData.catalogues.length ? <Empty icon="folder-open-outline" title="Your first catalogue" sub="Upload groceries, meat, or any CSV and give it a name." /> : null}
  </View>;

  const single = idleData && idleData.catalogues.length <= 1 ? idleData.catalogue?.name : undefined;
  const status = idle ? `${total.toLocaleString()} item${total === 1 ? "" : "s"}${single ? ` in ${single}` : ""}` : waiting ? "Searching…" : `${count} result${count === 1 ? "" : "s"} for “${q}”`;
  const header = <View style={styles.header} testID="search-controls">
    <View style={[styles.field, { backgroundColor: t.surface, borderColor: focused ? t.brand : t.line }]} testID="search-field">
      <Ionicons name="search" size={20} color={focused ? t.brand : t.muted} />
      <View style={styles.inputWrap}>
        <TextInput ref={box} value={typed} onChangeText={changeSearch}
          onFocus={() => { setFocused(true); keyboard.reveal(box.current); }} onBlur={() => setFocused(false)}
          placeholder={focused ? "Name or code" : ""} placeholderTextColor={t.muted}
          accessibilityLabel="Search your private catalogue" autoCapitalize="none" autoCorrect={false}
          returnKeyType="search" onSubmitEditing={() => { setQ(typed.trim()); box.current?.blur(); }} testID="plu-q" style={[styles.input, { color: t.text }]} />
        <TypedPlaceholder phrases={phrases} prefix="Try " show={!focused && !typed} style={{ color: t.muted, fontSize: 17 }} />
      </View>
      {typed ? <Pressable onPress={() => { tick(); changeSearch(""); box.current?.focus(); }} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={4}
        style={({ pressed }) => [styles.icon, { backgroundColor: pressed ? t.surface2 : "transparent" }]}>
        <Ionicons name="close-circle" size={20} color={t.muted} />
      </Pressable> : hasPlu ? <Pressable onPress={photo} accessibilityRole="button" accessibilityLabel="Photo search" testID="plu-photo" hitSlop={4}
        style={({ pressed }) => [styles.icon, { backgroundColor: pressed ? t.surface2 : "transparent" }]}>
        <Ionicons name="camera-outline" size={21} color={t.text2} />
      </Pressable> : null}
    </View>
    <View style={styles.meta}>
      <Text style={{ color: t.muted, fontSize: 13, flexShrink: 1 }} accessibilityLiveRegion="polite" numberOfLines={1}>{status}</Text>
      {idleData && idleData.catalogues.length > 1 ? <View style={styles.where}><Select value={String(idleData.catalogue?.id || "")}
        options={idleData.catalogues.map(c => ({ value: String(c.id), label: c.name }))}
        label="Search catalogue" testID="search-catalogue" onChange={chooseCatalogue} /></View> : null}
    </View>
    {idleQuery.error ? <ErrorBanner error={idleQuery.error} onRetry={idleQuery.refetch} /> : null}
    {!idle && search.error ? <ErrorBanner error={search.error} onRetry={search.refetch} /> : null}
  </View>;
  const shownRows = catalogues || idle || waiting ? [] : rows;

  // Both views live in the one list: switching between them only changes
  // what the list holds. Swapping one scroller for another tore the page
  // down mid-tap on a phone — the segments, the bar's spacing and the tab
  // bar's hold on the scroll view all started again from nothing.
  return <Screen>
    <RevealProvider value={keyboard.reveal}>
      <WithDepth>{(under) => <FlatList<CatalogueItem> ref={list} testID="search-results" style={{ flex: 1 }}
        {...under.scroll}
        data={shownRows}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={[layout.column, styles.list, { paddingTop: under.padTop, paddingBottom: layout.bottom + sp[6] }]}
        ListHeaderComponent={<>{workspaceHeader}{catalogues ? catalogueContent : header}</>}
        renderItem={({ item, index }) => <Result item={item} first={index === 0} last={index === shownRows.length - 1} />}
        ListEmptyComponent={catalogues || idle ? null : waiting ? <SkeletonRows count={4} />
          : <Empty icon="search-outline" title="No matches" sub={`Nothing found for “${q}”. Try fewer words, or a code.`} />}
        ListFooterComponent={!catalogues && !idle && !waiting && search.data && search.data.pages > 1 ? <View style={styles.pager} accessibilityLabel="Search pagination">
          <Button title="Previous" kind="plain" size="sm" style={styles.pageButton} disabled={search.data.page <= 1 || search.isFetching} onPress={() => goToPage(search.data!.page - 1)} />
          <Text accessibilityLiveRegion="polite" style={{ color: t.muted, fontSize: 12 }}>Page {search.data.page} of {search.data.pages}</Text>
          <Button title="Next" kind="plain" size="sm" style={styles.pageButton} disabled={!search.data.next || search.isFetching} onPress={() => goToPage(search.data!.next!)} />
        </View> : null}
        onScroll={(e) => { keyboard.onScroll(e); under.onScroll(e); }} scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false} />}</WithDepth>
    </RevealProvider>
  </Screen>;
}

/** One line of the results: code, then what it is. The lines join into one panel. */
function Result({ item, first, last }: { item: CatalogueItem; first: boolean; last: boolean }) {
  const t = useTheme();
  return <View testID="search-result" style={[styles.result, { backgroundColor: t.surface, borderColor: t.line },
    first && styles.resultFirst, last ? styles.resultLast : { borderBottomWidth: StyleSheet.hairlineWidth }]}>
    <Text selectable style={{ color: t.brandStrong, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"], width: 96, maxWidth: "36%", flexShrink: 1 }}>{item.code || "—"}</Text>
    <Text style={{ flex: 1, minWidth: 0, color: t.text, fontSize: 15, lineHeight: 21 }}>{item.description || item.title}</Text>
  </View>;
}

/**
 * What the box types to show what it takes: a real name from this catalogue,
 * then a real code, in turn — so the example is always something that would
 * be found. Names are shortened to a few words and written in sentence case.
 */
function examples(samples: CatalogueItem[]): string[] {
  const out: string[] = [];
  for (const item of samples.slice(0, 3)) {
    const name = (item.title || item.description || "").trim().split(/\s+/).slice(0, 3).join(" ").toLowerCase();
    if (name) out.push(name.charAt(0).toUpperCase() + name.slice(1));
    if (item.code) out.push(item.code);
  }
  return out.length ? out : ["Bananas", "4011", "Scotch fillet", "2201"];
}

const styles = StyleSheet.create({
  workspaceHeader: { paddingTop: sp[4], paddingBottom: sp[3], gap: sp[4] },
  catalogueContent: { gap: sp[3] },
  list: { paddingTop: sp[1] },
  header: { gap: sp[3], paddingBottom: sp[4] },
  title: { fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.8 },
  field: { flexDirection: "row", alignItems: "center", gap: sp[2], minHeight: 58, paddingLeft: sp[4], paddingRight: sp[1], borderRadius: radius.pill, borderWidth: 1.5 },
  inputWrap: { flex: 1, minWidth: 0, justifyContent: "center" },
  input: { minHeight: 54, paddingVertical: sp[3], fontSize: 17 },
  icon: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[3], minHeight: 32, paddingHorizontal: sp[2] },
  where: { flexShrink: 1, minWidth: 140, maxWidth: "60%" },
  catalogueRow: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  photoHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: sp[3] },
  photoTitle: { flex: 1, minWidth: 120, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: sp[3], minHeight: 44, borderRadius: radius.pill },
  result: { flexDirection: "row", alignItems: "flex-start", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3] + 2, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  resultFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  resultLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  pageButton: { minHeight: 44, paddingHorizontal: sp[3] },
  pager: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: sp[2], paddingTop: sp[4] },
});
