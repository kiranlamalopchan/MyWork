/** The hub: the next holiday, the row of stories, the top of the board. */
import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useHome } from "@/api";
import { Button, Card, ErrorBanner, Loading, Screen, Sub } from "@/ui";
import { NoticeCard } from "@/ui/NoticeCard";
import { StoriesTray } from "@/ui/StoriesTray";
import { sp, useTheme } from "@/ui/theme";

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { data, isLoading, error, refetch, isRefetching } = useHome();

  return (
    <Screen>
      <ScrollView refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.brand} />} contentContainerStyle={{ paddingBottom: sp[6] }}>
        {error ? <ErrorBanner message={(error as Error).message} onRetry={refetch} /> : null}
        {isLoading ? <Loading /> : null}
        {data ? (
          <>
            <Pressable onPress={() => router.push("/holidays")} style={{ paddingHorizontal: sp[4], paddingTop: sp[3] }}>
              <Card style={styles.holiday}>
                {data.holiday.holiday ? (
                  <>
                    <View style={[styles.date, { backgroundColor: t.brandSoft }]}>
                      <Text style={{ color: t.brand, fontWeight: "800", fontSize: 11 }}>{data.holiday.holiday.month_short}</Text>
                      <Text style={{ color: t.brand, fontWeight: "800", fontSize: 20, lineHeight: 22 }}>{data.holiday.holiday.day}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.muted, fontSize: 12, fontWeight: "600" }}>NEXT PUBLIC HOLIDAY · {data.holiday.state}</Text>
                      <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }} numberOfLines={1}>{data.holiday.holiday.name}</Text>
                      <Text style={{ color: t.text2, fontSize: 13 }}>{data.holiday.holiday.weekday} · {data.holiday.holiday.countdown}</Text>
                    </View>
                  </>
                ) : (
                  <Sub>No public holidays loaded yet for {data.holiday.state}.</Sub>
                )}
                <Ionicons name="chevron-forward" size={18} color={t.muted} />
              </Card>
            </Pressable>

            <StoriesTray rows={data.stories} />

            <View style={styles.boardHead}>
              <Ionicons name="chatbubbles-outline" size={20} color={t.brand} />
              <Text style={[styles.boardTitle, { color: t.text }]}>Notice board</Text>
              <View style={{ flex: 1 }} />
              <Button title="Post" icon="add" onPress={() => router.push("/notices/compose")} style={{ minHeight: 38, paddingHorizontal: 14 }} />
            </View>
            <View style={{ paddingHorizontal: sp[4], gap: sp[3] }}>
              {data.notices.length === 0 ? (
                <Card><Sub style={{ textAlign: "center" }}>Nothing on the board — post the first notice; everyone signed in will see it.</Sub></Card>
              ) : data.notices.map((n) => <NoticeCard key={n.id} notice={n} />)}
              {data.notice_total > data.notices.length ? (
                <Button title={`See all ${data.notice_total} notices`} kind="plain" onPress={() => router.push("/(tabs)/board")} />
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  holiday: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  date: { width: 48, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  boardHead: { flexDirection: "row", alignItems: "center", gap: sp[2], paddingHorizontal: sp[4], paddingTop: sp[3], paddingBottom: sp[2] },
  boardTitle: { fontSize: 18, fontWeight: "700" },
});
