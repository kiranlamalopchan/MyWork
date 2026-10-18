/** Native catalogue search: one scrolling page, with room for the keyboard. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useCatalogueIdle, useCatalogueSearch, type CatalogueItem } from "@/api/catalogue";
import { Button, Card, Empty, ErrorBanner, Page, PageTitle, Screen, Segments } from "@/ui";
import { tick } from "@/ui/haptics";
import { RevealProvider, useKeyboardScroll } from "@/ui/keyboard";
import { useLayout } from "@/ui/layout";
import { Select } from "@/ui/Select";
import { usePrivateState } from "@/storage/private";
import { SavedProducts, type ProductHistory } from "@/ui/SavedProducts";
import { PhotoSearch } from "@/ui/PhotoSearch";
import { SkeletonRows } from "@/ui/Skeleton";
import { radius, sp, useTheme } from "@/ui/theme";

export default function Plu() {
  const t = useTheme();
  const layout = useLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{ catalogue?: string; view?: string }>();
  const catalogueId = params.catalogue ? Number(params.catalogue) : undefined;
  const [mode, setMode] = usePrivateState<"search" | "photo">("items-mode", "search");
  const [typed, setTyped] = usePrivateState(`items-query:${catalogueId || "default"}`, "");
  const [history, setHistory] = usePrivateState<ProductHistory>("product-history", { favorites: [], recent: [] });
  const [q, setQ] = useState("");
  const box = useRef<TextInput>(null);
  const list = useRef<FlatList<CatalogueItem>>(null);
  const keyboard = useKeyboardScroll(useCallback((y: number) => list.current?.scrollToOffset({ offset: y, animated: true }), []));

  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(id);
  }, [typed]);

  const search = useCatalogueSearch(q, catalogueId);
  const idleQuery = useCatalogueIdle(catalogueId);
  const idleData = idleQuery.data;
  const hasPlu = ["plu", "plu_no"].includes(idleData?.catalogue?.code_column.toLowerCase() || "");
  const idle = !typed.trim();
  const waiting = !idle && (typed.trim() !== q || search.isLoading);
  const rows = search.data?.pages.flatMap(p => p.results) ?? [];
  const count = search.data?.pages[0]?.count ?? 0;
  const total = idleData?.total ?? 0;

  const openItem = (item: CatalogueItem) => {
    setHistory(previous => ({ ...previous, recent: [item, ...previous.recent.filter(row => row.id !== item.id)].slice(0, 20) }));
    router.push(`/plu/${item.id}`);
  };
  const favorite = (item: CatalogueItem) => setHistory(previous => ({
    ...previous,
    favorites: previous.favorites.some(row => row.id === item.id)
      ? previous.favorites.filter(row => row.id !== item.id) : [...previous.favorites, item],
  }));
  const upload = () => router.push("/items/import");
  const photo = () => { tick(); setMode("photo"); };

  if (mode === "photo") return (
    <Screen>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={[layout.column, { paddingTop: sp[4], gap: sp[4], paddingBottom: layout.bottom + sp[6] }]}>
        <View style={styles.photoHead}>
          <Pressable onPress={() => { tick(); setMode("search"); }} accessibilityRole="button" accessibilityLabel="Back to search"
            style={({ pressed }) => [styles.back, { backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name="chevron-back" size={18} color={t.text} />
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 15 }}>Search</Text>
          </Pressable>
          <Text style={[styles.photoTitle, { color: t.text }]}>Photo search</Text>
        </View>
        <PhotoSearch key={idleData?.catalogue?.id} catalogueId={idleData?.catalogue?.id} />
      </ScrollView>
    </Screen>
  );

  if (params.view === "catalogues") return <Screen section="Items"><Page>
    <Text style={[styles.eyebrow, { color: t.muted }]}>YOUR PRIVATE CATALOGUES</Text>
    <PageTitle sub="Choose a catalogue to search, or upload a new one.">Your catalogues</PageTitle>
    <Segments value="catalogues" onChange={view => router.setParams({ view })} options={[{ value: "search", label: "Search" }, { value: "catalogues", label: "My catalogues" }]} />
    <Button title="Upload a new catalogue" icon="add" onPress={upload} />
    {idleQuery.error ? <ErrorBanner error={idleQuery.error} onRetry={idleQuery.refetch} /> : null}
    {idleQuery.isLoading ? <SkeletonRows count={3} /> : null}
    {idleData?.catalogues.map(saved => <Card key={saved.id}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Search ${saved.name}`}
        onPress={() => { setTyped(""); setQ(""); router.setParams({ catalogue: String(saved.id), view: "search" }); }} style={styles.catalogueRow}>
        <Ionicons name="folder-outline" size={24} color={t.brandStrong} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 18 }}>{saved.name}</Text>
          <Text style={{ color: t.muted, marginTop: sp[1] }}>{saved.count.toLocaleString()} private items · Tap to search</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.muted} />
      </Pressable>
    </Card>)}
    {idleData && !idleData.catalogues.length ? <Empty icon="folder-open-outline" title="Your first catalogue" sub="Upload groceries, meat, or any CSV and give it a name." /> : null}
  </Page></Screen>;

  const header = <View style={styles.header} testID="search-controls">
    <View style={styles.heading}>
      <Text style={[styles.eyebrow, { color: t.muted }]}>YOUR PRIVATE CATALOGUES</Text>
      <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">Search</Text>
      <Text style={[styles.subtitle, { color: t.muted }]}>Find products and codes in your saved catalogues.</Text>
    </View>
    <Segments value="search" onChange={view => router.setParams({ view })} options={[{ value: "search", label: "Search" }, { value: "catalogues", label: "My catalogues" }]} />
    <Card pad={false} style={styles.searchCard}>
      {idleData?.catalogues.length ? <View style={styles.control}>
        <Text style={[styles.label, { color: t.text2 }]}>Catalogue</Text>
        <Select value={String(idleData.catalogue?.id || "")}
          options={idleData.catalogues.map(c => ({ value: String(c.id), label: `${c.name} (${c.count})` }))}
          label="Search catalogue" testID="search-catalogue" onChange={value => router.setParams({ catalogue: value })} />
      </View> : null}
      <View style={styles.control}>
        <Text style={[styles.label, { color: t.text2 }]}>Search items</Text>
        <View style={[styles.field, { backgroundColor: t.surface2, borderColor: t.line }]} testID="search-field">
          <Ionicons name="search-outline" size={20} color={t.muted} />
          <TextInput ref={box} value={typed} onChangeText={setTyped}
            onFocus={() => keyboard.reveal(box.current)}
            placeholder="Name, description or code" placeholderTextColor={t.muted}
            accessibilityLabel="Search your private catalogue" autoCapitalize="none" autoCorrect={false}
            returnKeyType="search" testID="plu-q" style={[styles.input, { color: t.text }]} />
          {typed ? <Pressable onPress={() => { tick(); setTyped(""); box.current?.focus(); }} accessibilityRole="button" accessibilityLabel="Clear search"
            style={({ pressed }) => [styles.clear, { backgroundColor: pressed ? t.surface3 : "transparent" }]}>
            <Ionicons name="close" size={19} color={t.text2} />
          </Pressable> : null}
        </View>
      </View>
    </Card>
    <View style={styles.actions}>
      {hasPlu ? <SearchAction title="Photo search" icon="camera-outline" onPress={photo} testID="plu-photo" /> : null}
      <SearchAction title="Upload" icon="cloud-upload-outline" onPress={upload} testID="plu-import" accessibilityLabel="Upload catalogue" />
    </View>
    {idleQuery.error ? <ErrorBanner error={idleQuery.error} onRetry={idleQuery.refetch} /> : null}
    {!idle && search.error ? <ErrorBanner error={search.error} onRetry={search.refetch} /> : null}
    {idle ? <>
      <SavedProducts history={history} catalogueId={idleData?.catalogue?.id} onOpen={openItem} onFavorite={favorite} />
      <View style={{ gap: sp[2] }}>
        <Text style={{ color: t.muted, fontSize: 13 }}>{total ? `${total.toLocaleString()} items · Private to your account` : "Your uploads are private to your account"}</Text>
        {idleData?.samples.length ? <Text style={[styles.sectionTitle, { color: t.text }]}>Browse a few items</Text> : null}
      </View>
    </> : <Text style={[styles.sectionTitle, { color: t.text }]} accessibilityLiveRegion="polite">
      {waiting ? "Searching…" : `${count} result${count === 1 ? "" : "s"} for “${q}”`}
    </Text>}
  </View>;

  return <Screen>
    <RevealProvider value={keyboard.reveal}>
      <FlatList<CatalogueItem> ref={list} testID="search-results" style={{ flex: 1 }}
        data={idle ? idleData?.samples ?? [] : waiting ? [] : rows}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={[layout.column, styles.list, { paddingBottom: layout.bottom + sp[6] }]}
        ListHeaderComponent={header}
        renderItem={({ item }) => <Result item={item} onPress={() => openItem(item)}
          favorite={history.favorites.some(row => row.id === item.id)} onFavorite={() => favorite(item)} />}
        ListEmptyComponent={idleQuery.isLoading || waiting ? <SkeletonRows count={5} /> : idle
          ? <Empty icon="search-outline" title={idleData?.catalogue ? "Ready to search" : "Add your first catalogue"}
              sub={idleData?.catalogue ? "Enter a name, description or code above." : "Upload a CSV to start searching your items."} />
          : <Empty icon="search-outline" title="No matches" sub={`Nothing found for “${q}”. Try fewer words, or a code.`} />}
        ListFooterComponent={!idle && search.isFetchingNextPage ? <SkeletonRows count={2} /> : null}
        onEndReached={() => !idle && !waiting && search.hasNextPage && !search.isFetchingNextPage && search.fetchNextPage()}
        onEndReachedThreshold={0.5} onScroll={keyboard.onScroll} scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
        contentInsetAdjustmentBehavior="automatic" removeClippedSubviews={false}
        showsVerticalScrollIndicator={false} />
    </RevealProvider>
  </Screen>;
}

function SearchAction({ title, icon, onPress, testID, accessibilityLabel }: {
  title: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; testID: string; accessibilityLabel?: string;
}) {
  const t = useTheme();
  return <Pressable onPress={() => { tick(); onPress(); }} accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} testID={testID}
    style={({ pressed }) => [styles.action, { backgroundColor: pressed ? t.brandSoft : t.surface, borderColor: t.line }]}>
    <Ionicons name={icon} size={20} color={t.brandStrong} />
    <Text style={{ color: t.text, fontSize: 14, fontWeight: "600", flexShrink: 1 }}>{title}</Text>
  </Pressable>;
}

function Result({ item, onPress, favorite, onFavorite }: {
  item: CatalogueItem; onPress: () => void; favorite: boolean; onFavorite: () => void;
}) {
  const t = useTheme();
  return <Card pad={false} style={styles.result}>
    <View style={styles.resultRow}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} style={styles.product}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          {item.code ? <View style={[styles.code, { backgroundColor: t.brandSoft }]}>
            <Text style={{ color: t.brandStrong, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] }} numberOfLines={2}>{item.code}</Text>
          </View> : null}
          <Text style={{ color: t.text, fontWeight: "600", fontSize: 16, lineHeight: 22 }} numberOfLines={3}>{item.title}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.muted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={favorite ? "Remove favourite" : "Save favourite"}
        onPress={() => { tick(); onFavorite(); }} style={styles.favorite}>
        <Ionicons name={favorite ? "star" : "star-outline"} size={23} color={t.brandStrong} />
      </Pressable>
    </View>
  </Card>;
}

const styles = StyleSheet.create({
  list: { paddingTop: sp[4], gap: sp[3] },
  header: { gap: sp[4], paddingBottom: sp[1] },
  heading: { gap: 6, paddingTop: sp[1] },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  subtitle: { fontSize: 14, lineHeight: 21 },
  searchCard: { padding: sp[4], gap: sp[4] },
  control: { gap: sp[2], minWidth: 0 },
  label: { fontSize: 13, fontWeight: "600" },
  field: { flexDirection: "row", alignItems: "center", gap: sp[2], minHeight: 56, paddingHorizontal: sp[3], borderRadius: radius.md, borderWidth: 1 },
  input: { flex: 1, minWidth: 0, minHeight: 52, paddingVertical: sp[3], fontSize: 16 },
  clear: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp[3] },
  action: { flex: 1, flexBasis: 120, minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sp[2], padding: sp[3], borderRadius: radius.md, borderWidth: 1 },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  catalogueRow: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  photoHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: sp[3] },
  photoTitle: { flex: 1, minWidth: 120, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: sp[3], minHeight: 44, borderRadius: radius.pill },
  result: { borderRadius: radius.lg },
  resultRow: { flexDirection: "row", alignItems: "center" },
  product: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: sp[2], padding: sp[4] },
  code: { alignSelf: "flex-start", maxWidth: "100%", paddingHorizontal: sp[2], paddingVertical: sp[1], borderRadius: 6 },
  favorite: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center", marginRight: sp[2] },
});
