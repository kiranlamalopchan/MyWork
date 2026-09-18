/** The frame the two sign-in pages share: the mark, a heading, a card of fields, a line under it. */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Link, type Href } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";

import { siteUrl } from "@/api/client";
import { Card, Page, Screen } from "@/ui";
import { BrandMark } from "@/ui/AppBar";
import { ServerPicker } from "@/ui/ServerPicker";
import { sp, useTheme } from "@/ui/theme";

export function AuthFrame({ title, sub, children, foot, link, linkHref, agree = false }: { title: string; sub: string; children: React.ReactNode; foot: string; link: string; linkHref: Href; agree?: boolean }) {
  const t = useTheme();
  const open = (path: string) => () => openBrowserAsync(siteUrl(path)).catch(() => {});
  const legal = { color: t.muted, fontSize: 13.5, textDecorationLine: "underline" as const };
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
        {/* Pointing a build at a laptop: not something a store build offers. */}
        {__DEV__ || Constants.expoConfig?.extra?.devServerPicker ? <ServerPicker /> : null}
        {agree ? (
          // Signing up is agreeing to the rules — the store review asks that the
          // terms say there is no tolerance for abuse, and they do.
          <Text style={{ color: t.muted, fontSize: 13.5, textAlign: "center", lineHeight: 19, paddingHorizontal: sp[4] }}>
            By creating an account you agree to the <Text style={legal} onPress={open("/safety/rules/")}>community rules</Text> and <Text style={legal} onPress={open("/privacy/")}>privacy policy</Text>.
          </Text>
        ) : (
          <View style={{ flexDirection: "row", gap: sp[3] }}>
            <Pressable onPress={open("/safety/rules/")} hitSlop={8} accessibilityRole="link"><Text style={legal}>Rules</Text></Pressable>
            <Pressable onPress={open("/privacy/")} hitSlop={8} accessibilityRole="link"><Text style={legal}>Privacy</Text></Pressable>
          </View>
        )}
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
