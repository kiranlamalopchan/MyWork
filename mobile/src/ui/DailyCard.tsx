/**
 * The hub's small pleasures: a thought for the day, and a little laugh
 * with its punchline behind a tap — a joke told, not printed. Both come
 * from the server's daily pick (mywork/daily.py), the same for everyone
 * and new at midnight.
 *
 * On a phone they sit side by side just under the stories, a glance each
 * (`compact`, and see DailyPair); on a wide screen, full size in the side
 * column under the holiday.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { Daily } from "@/api/types";

import { Card } from "./index";
import { useLayout } from "./layout";
import { mix, sp, useTheme } from "./theme";

type Props = { compact?: boolean; style?: StyleProp<ViewStyle> };

export function QuoteCard({ quote, compact, style }: { quote: Daily["quote"] } & Props) {
  const t = useTheme();
  return (
    <Card style={[compact && styles.compactCard, style]} pad={!compact} tint={mix(t.brand, t.surface, 0.08)} testID="daily-quote">
      <View style={styles.kicker}>
        <Ionicons name="sparkles-outline" size={compact ? 13 : 14} color={t.brandStrong} />
        <Text style={[styles.kickerText, compact && styles.kickerCompact, { color: t.brandStrong }]}>Thought for the day</Text>
      </View>
      <Text style={[styles.quoteText, compact && styles.quoteCompact, { color: t.text }]}>{quote.text}</Text>
      <Text style={[styles.who, compact && styles.whoCompact, { color: t.muted }]}>— {quote.who}</Text>
    </Card>
  );
}

export function JokeCard({ joke, compact, style }: { joke: Daily["joke"] } & Props) {
  const t = useTheme();
  const [told, setTold] = useState(false);
  return (
    <Card style={[compact && styles.compactCard, style]} pad={!compact} testID="daily-joke">
      <Pressable onPress={() => setTold((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: told }} testID="daily-punchline">
        <View style={styles.kicker}>
          <Ionicons name="happy-outline" size={compact ? 14 : 15} color={t.brandStrong} />
          <Text style={[styles.kickerText, compact && styles.kickerCompact, { color: t.brandStrong }]}>A little laugh</Text>
        </View>
        <Text style={[styles.setup, compact && styles.setupCompact, { color: t.text }]}>{joke.setup}</Text>
        {told ? (
          <Text style={[styles.punchline, compact && styles.setupCompact, { color: t.text2 }]}>{joke.punchline}</Text>
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

/**
 * The two as a pair under the stories on a phone: side by side, the same
 * height, a glance each. The quotes stay under a hundred characters and
 * the setups shorter, so half a phone is room enough — below about 330
 * points of column, where half is not, they stack instead.
 */
export function DailyPair({ daily }: { daily: Daily }) {
  const { width, gutter } = useLayout();
  const side = width - 2 * gutter >= 330;
  return (
    <View style={side ? styles.pair : styles.stack} testID="daily-pair">
      <QuoteCard quote={daily.quote} compact style={side && styles.half} />
      <JokeCard joke={daily.joke} compact style={side && styles.half} />
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { flexDirection: "row", alignItems: "center", gap: 6 },
  kickerText: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  kickerCompact: { fontSize: 10.5, letterSpacing: 0.3, flexShrink: 1 },
  quoteText: { marginTop: sp[2], fontSize: 17, lineHeight: 24, fontWeight: "600", letterSpacing: -0.2 },
  quoteCompact: { fontSize: 15, lineHeight: 20 },
  who: { marginTop: sp[2], fontSize: 13.5 },
  whoCompact: { fontSize: 12.5 },
  setup: { marginTop: sp[2], fontSize: 15, lineHeight: 22, fontWeight: "600" },
  setupCompact: { fontSize: 14.5, lineHeight: 20 },
  punchline: { marginTop: sp[2], fontSize: 15, lineHeight: 22 },
  reveal: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: sp[2] },
  compactCard: { padding: sp[4] },
  pair: { flexDirection: "row", alignItems: "stretch", gap: sp[3] },
  stack: { gap: sp[3] },
  half: { flex: 1, minWidth: 0 },
});
