/** The frame the two sign-in pages share: the mark, a heading, a card of fields, a line under it. */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Link, type Href } from "expo-router";

import { Card, Page, Screen } from "@/ui";
import { BrandMark } from "@/ui/AppBar";
import { ServerPicker } from "@/ui/ServerPicker";
import { sp, useTheme } from "@/ui/theme";

export function AuthFrame({ title, sub, children, foot, link, linkHref }: { title: string; sub: string; children: React.ReactNode; foot: string; link: string; linkHref: Href }) {
  const t = useTheme();
  return (
    <Screen tools={false}>
      <Page contentContainerStyle={styles.wrap}>
        <View style={[styles.mark, { shadowColor: t.brand }]}>
          <BrandMark size={88} />
        </View>
        <Text style={[styles.title, { color: t.text }]}>{title}</Text>
        <Text style={[styles.sub, { color: t.muted }]}>{sub}</Text>
        <Card style={{ width: "100%", gap: sp[4], marginTop: sp[2] }}>{children}</Card>
        <Text style={{ color: t.muted, fontSize: 15, marginTop: sp[2] }}>
          {foot} <Link href={linkHref} style={{ color: t.brand, fontWeight: "700" }}>{link}</Link>
        </Text>
        <ServerPicker />
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingTop: sp[8], gap: sp[3], maxWidth: 520, width: "100%", alignSelf: "center" },
  mark: { marginBottom: sp[3], shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  title: { fontSize: 32, fontWeight: "800", letterSpacing: -1 },
  sub: { fontSize: 16, textAlign: "center", marginTop: -sp[2], lineHeight: 22 },
});
