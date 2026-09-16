/** One PLU (templates/plu/plu_detail.html): the code, large, and a button to copy it. */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { plu } from "@/api";
import { goBack } from "@/nav/paths";
import { Button, Card, ErrorBanner, Loading, Page, Screen } from "@/ui";
import { native } from "@/ui/native";
import { sp, useTheme } from "@/ui/theme";

export default function PluItem() {
  const t = useTheme();
  const { plu_no } = useLocalSearchParams<{ plu_no: string }>();
  const q = useQuery({ queryKey: ["plu-item", plu_no], queryFn: () => plu.one(Number(plu_no)) });
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const Clipboard = native<typeof import("expo-clipboard")>(() => require("expo-clipboard"));
    await Clipboard.setStringAsync(String(q.data?.plu_no ?? plu_no));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Screen back backLabel="PLU">
      <Page>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <Loading /> : null}
        {q.data ? (
          <>
            <Card style={styles.hero}>
              <Text style={[styles.kicker, { color: t.brand }]}>PLU code</Text>
              <Text style={[styles.code, { color: t.text }]}>{q.data.plu_no}</Text>
              <Text style={[styles.desc, { color: t.text2 }]}>{q.data.description}</Text>
            </Card>
            <View style={{ gap: sp[3] }}>
              <Button title={copied ? "Copied" : "Copy PLU number"} icon={copied ? "checkmark" : "copy-outline"} onPress={copy} />
              <Button title="Back to search" icon="chevron-back" kind="plain" onPress={goBack} />
            </View>
          </>
        ) : null}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingVertical: sp[8], gap: sp[2] },
  kicker: { fontSize: 13, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase" },
  code: { fontSize: 64, fontWeight: "800", letterSpacing: -2, lineHeight: 70, fontVariant: ["tabular-nums"] },
  desc: { fontSize: 20, textAlign: "center" },
});
