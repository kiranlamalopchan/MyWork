/** PLU lookup: type, and the codes come, ranked the way the scale wants them. */
import React, { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { usePluSearch } from "@/api";
import { Empty, ErrorBanner, Input, Loading, Screen } from "@/ui";
import { radius, sp, useTheme } from "@/ui/theme";

export default function Plu() {
  const t = useTheme();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(id);
  }, [typed]);
  const search = usePluSearch(q);
  const rows = search.data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <Screen>
      <View style={{ padding: sp[4], paddingBottom: sp[2] }}>
        <Input placeholder="Code or name — e.g. 7012, lamb chops" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" testID="plu-q" />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(i) => String(i.plu_no)}
        contentContainerStyle={{ paddingHorizontal: sp[4], paddingBottom: sp[6], gap: sp[2] }}
        onEndReached={() => search.hasNextPage && !search.isFetchingNextPage && search.fetchNextPage()}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={search.error ? <ErrorBanner message={(search.error as Error).message} onRetry={search.refetch} /> : null}
        ListEmptyComponent={
          !q ? <Empty icon="search-outline" title="Look up a PLU" sub="Type a code or part of a name." />
          : search.isLoading ? <Loading />
          : <Empty icon="close-circle-outline" title={`Nothing for “${q}”`} sub="Try fewer words, or the code." />
        }
        ListFooterComponent={search.isFetchingNextPage ? <Loading /> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/plu/${item.plu_no}`)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.line }]}>
            <View style={[styles.code, { backgroundColor: t.brandSoft }]}>
              <Text style={{ color: t.brand, fontWeight: "800", fontSize: 18 }}>{item.plu_no}</Text>
            </View>
            <Text style={{ color: t.text, fontWeight: "600", fontSize: 16, flex: 1 }}>{item.description}</Text>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3], borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  code: { minWidth: 72, paddingHorizontal: 10, height: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
