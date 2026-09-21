/**
 * The hub's small pleasures, on a wide screen, in the side column under
 * the holiday: a thought for the day, and a little laugh with its
 * punchline behind a tap — a joke told, not printed. Both come
 * from the server's daily pick (mywork/daily.py), the same for everyone
 * and new at midnight.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { Daily } from "@/api/types";

import { Card } from "./index";
import { mix, sp, useTheme } from "./theme";

export function QuoteCard({ quote, style }: { quote: Daily["quote"]; style?: object }) {
  const t = useTheme();
  return (
    <Card style={style} tint={mix(t.brand, t.surface, 0.08)} testID="daily-quote">
      <View style={styles.kicker}>
        <Ionicons name="sparkles-outline" size={14} color={t.brandStrong} />
        <Text style={[styles.kickerText, { color: t.brandStrong }]}>Thought for the day</Text>
      </View>
      <Text style={[styles.quoteText, { color: t.text }]}>{quote.text}</Text>
      <Text style={[styles.who, { color: t.muted }]}>— {quote.who}</Text>
    </Card>
  );
}

export function JokeCard({ joke }: { joke: Daily["joke"] }) {
  const t = useTheme();
  const [told, setTold] = useState(false);
  return (
    <Card testID="daily-joke">
      <Pressable onPress={() => setTold((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: told }} testID="daily-punchline">
        <View style={styles.kicker}>
          <Ionicons name="happy-outline" size={15} color={t.brandStrong} />
          <Text style={[styles.kickerText, { color: t.brandStrong }]}>A little laugh</Text>
        </View>
        <Text style={[styles.setup, { color: t.text }]}>{joke.setup}</Text>
        {told ? (
          <Text style={[styles.punchline, { color: t.text2 }]}>{joke.punchline}</Text>
        ) : (
          <View style={styles.reveal}>
            <Ionicons name="chevron-down" size={14} color={t.brandStrong} />
            <Text style={{ color: t.brandStrong, fontSize: 13, fontWeight: "700" }}>Punchline</Text>
          </View>
        )}
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  kicker: { flexDirection: "row", alignItems: "center", gap: 6 },
  kickerText: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  quoteText: { marginTop: sp[2], fontSize: 17, lineHeight: 24, fontWeight: "600", letterSpacing: -0.2 },
  who: { marginTop: sp[2], fontSize: 13.5 },
  setup: { marginTop: sp[2], fontSize: 15, lineHeight: 22, fontWeight: "600" },
  punchline: { marginTop: sp[2], fontSize: 15, lineHeight: 22 },
  reveal: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: sp[2] },
});
