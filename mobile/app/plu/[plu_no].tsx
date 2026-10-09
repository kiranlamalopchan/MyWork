/** One PLU (templates/plu/plu_detail.html): the code, large, and a button to copy it. */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { catalogue } from "@/api/catalogue";
import { useSession } from "@/auth/session";
import { goBack } from "@/nav/paths";
import { Button, Card, ErrorBanner, Page, Screen } from "@/ui";
import { SkeletonPlu } from "@/ui/Skeleton";
import { native } from "@/ui/native";
import { sp, useTheme } from "@/ui/theme";

export default function PluItem() {
  const t = useTheme();
  const { me } = useSession();
  const { plu_no } = useLocalSearchParams<{ plu_no: string }>();
  const q = useQuery({ queryKey: ["catalogue", me?.username, "item", plu_no], queryFn: () => catalogue.one(Number(plu_no)) });
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const Clipboard = native<typeof import("expo-clipboard")>(() => require("expo-clipboard"));
    await Clipboard.setStringAsync(q.data?.code || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Screen back backLabel="Items">
      <Page>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonPlu /> : null}
        {q.data ? (
          <>
            <Card style={styles.hero}>
              <Text style={[styles.kicker, { color: t.brand }]}>Item</Text>
              {q.data.code ? <Text style={[styles.code, { color: t.text }]}>{q.data.code}</Text> : null}
              <Text style={[styles.desc, { color: t.text2 }]}>{q.data.title}</Text>
            </Card>
            <Card style={{ gap: sp[3] }}>{Object.entries(q.data.fields).map(([heading, value]) => <View key={heading}><Text style={{ color: t.muted, fontWeight: "700" }}>{heading}</Text><Text selectable style={{ color: t.text, fontSize: 16 }}>{value || "—"}</Text></View>)}</Card>
            <View style={{ gap: sp[3] }}>
              {q.data.code ? <Button title={copied ? "Copied" : "Copy code"} icon={copied ? "checkmark" : "copy-outline"} onPress={copy} /> : null}
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
  code: { fontSize: 36, fontWeight: "800", letterSpacing: -2, lineHeight: 44, fontVariant: ["tabular-nums"] },
  desc: { fontSize: 20, textAlign: "center" },
});
