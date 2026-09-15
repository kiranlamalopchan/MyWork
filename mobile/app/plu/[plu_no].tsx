import React from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { plu } from "@/api";
import { Card, ErrorBanner, Loading, Screen, Sub } from "@/ui";
import { sp, useTheme } from "@/ui/theme";

export default function PluItem() {
  const t = useTheme();
  const { plu_no } = useLocalSearchParams<{ plu_no: string }>();
  const q = useQuery({ queryKey: ["plu-item", plu_no], queryFn: () => plu.one(Number(plu_no)) });
  return (
    <Screen style={{ padding: sp[4] }}>
      {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
      {q.isLoading ? <Loading /> : null}
      {q.data ? (
        <Card style={{ alignItems: "center", paddingVertical: sp[6] }}>
          <Sub>PLU</Sub>
          <Text style={{ color: t.brand, fontWeight: "900", fontSize: 64, letterSpacing: -2 }}>{q.data.plu_no}</Text>
          <View style={{ height: sp[2] }} />
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 20, textAlign: "center" }}>{q.data.description}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}
