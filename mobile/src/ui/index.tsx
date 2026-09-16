/**
 * The pieces every screen is made of: a face, a panel, the page's big title,
 * a section heading, a button, a field, a segmented control, the row of
 * seven faces to react with, a tally. One look for all of them — solid
 * panels with soft shadows, filled fields, pill buttons — so a screen only
 * has to say what it holds.
 */
import React, { useCallback, useRef } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView, ScrollViewProps, StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { Emoji, ReactionTally } from "@/api";

import { AppBar } from "./AppBar";
import { Backdrop } from "./Backdrop";
import { tap, tick } from "./haptics";
import { KeyboardPad, RevealProvider, useKeyboardScroll, useReveal } from "./keyboard";
import { useLayout } from "./layout";
import { alpha, radius, sp, useTheme } from "./theme";

export { Avatar } from "./Avatar";
export { useLayout } from "./layout";

// ---- the page --------------------------------------------------------------------

/**
 * A screen: the washes behind, the app bar on top, the page under it. The
 * page scrolls itself (a ScrollView or a list) so a long one keeps the bar,
 * and it shrinks for the keyboard so nothing you type is hidden under it.
 */
export function Screen({ children, title, back, backLabel, section, right, tools, style }: {
  children: React.ReactNode; title?: string; back?: boolean; backLabel?: string; section?: string; right?: React.ReactNode; tools?: boolean; style?: ViewStyle;
}) {
  return (
    <View style={[{ flex: 1 }, style]}>
      <Backdrop />
      <AppBar title={title} back={back} backLabel={backLabel} section={section} right={right} tools={tools} />
      <KeyboardPad>{children}</KeyboardPad>
    </View>
  );
}

/**
 * The scrolling page column: the gutter each side (tighter on a small
 * phone, centred and capped on a tablet), room for the tab bar below. A
 * box on it that takes focus is scrolled clear of the keyboard.
 */
export function Page({ children, contentContainerStyle, onScroll, ...rest }: ScrollViewProps & { children: React.ReactNode }) {
  const layout = useLayout();
  const ref = useRef<ScrollView>(null);
  const keyboard = useKeyboardScroll(useCallback((y: number) => ref.current?.scrollTo({ y, animated: true }), []));
  return (
    <RevealProvider value={keyboard.reveal}>
      <ScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        {...rest}
        onScroll={(e) => { keyboard.onScroll(e); onScroll?.(e); }}
        contentContainerStyle={[styles.page, layout.column, { paddingBottom: layout.bottom + sp[6] }, contentContainerStyle]}
      >
        {children}
      </ScrollView>
    </RevealProvider>
  );
}

/** Room under the last thing on a page (see `useLayout().bottom` for the live figure). */
export const PAGE_BOTTOM = Platform.OS === "ios" ? 24 : 40;

export function PageTitle({ children, sub, style }: { children: React.ReactNode; sub?: string; style?: ViewStyle }) {
  const t = useTheme();
  const { compact } = useLayout();
  return (
    <View style={[styles.pageHead, style]}>
      <Text style={[styles.pageTitle, { color: t.text }, compact && { fontSize: 29, lineHeight: 34 }]}>{children}</Text>
      {sub ? <Text style={[styles.pageSub, { color: t.muted }]}>{sub}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[styles.sectionLabel, { color: t.muted }, style]}>{children}</Text>;
}

// ---- surfaces --------------------------------------------------------------------

/**
 * A panel: a solid surface with a soft, wide shadow under it and no visible
 * edge in the light; in the dark, a hairline instead of the shadow. Inside
 * another panel (`inset`) it is a quieter, filled block.
 */
export function Card({ children, style, pad = true, inset, tint, testID, onPress }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; pad?: boolean; inset?: boolean; tint?: string; testID?: string; onPress?: () => void;
}) {
  const t = useTheme();
  const look = inset
    ? { backgroundColor: t.surface2, borderColor: "transparent" }
    : { backgroundColor: tint ? tint : t.surface, borderColor: t.dark ? t.line : "transparent", ...glassShadow(t.shadow, t.dark) };
  const body = (
    <View testID={testID} style={[styles.card, look, pad && { padding: sp[5] }, style]}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.985 : 1 }], opacity: pressed ? 0.92 : 1 })}>{body}</Pressable>;
}

/** The panel's shadow: barely there in the light, none in the dark. */
export function glassShadow(colour: string, dark: boolean): ViewStyle {
  if (Platform.OS === "android") return { elevation: dark ? 0 : 1 };
  return dark ? {} : { shadowColor: colour, shadowOpacity: 0.07, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } };
}

export function Title({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[styles.title, { color: t.text }, style]}>{children}</Text>;
}

export function Sub({ children, style }: { children: React.ReactNode; style?: any }) {
  const t = useTheme();
  return <Text style={[styles.sub, { color: t.muted }, style]}>{children}</Text>;
}

export function Body({ children, style, numberOfLines }: { children: React.ReactNode; style?: any; numberOfLines?: number }) {
  const t = useTheme();
  return <Text style={[styles.body, { color: t.text }, style]} numberOfLines={numberOfLines}>{children}</Text>;
}

export function Rule({ style }: { style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: sp[4] }, style]} />;
}

export function Empty({ icon, title, sub, action, card = true }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; action?: React.ReactNode; card?: boolean }) {
  const t = useTheme();
  const body = (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: t.brandSoft }]}>
        <Ionicons name={icon} size={28} color={t.brand} />
      </View>
      <Text style={[styles.emptyTitle, { color: t.text }]}>{title}</Text>
      {sub ? <Text style={[styles.emptySub, { color: t.muted }]}>{sub}</Text> : null}
      {action ? <View style={{ marginTop: sp[4] }}>{action}</View> : null}
    </View>
  );
  return card ? <Card pad={false}>{body}</Card> : body;
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={t.brand} />
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={[styles.alert, { backgroundColor: t.dangerSoft, borderColor: alpha(t.danger, 0.25) }]}>
      <Text style={{ color: t.danger, flex: 1, fontSize: 14.5, lineHeight: 20 }}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={{ color: t.danger, fontWeight: "700" }}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- controls --------------------------------------------------------------------

export function Button({
  title, onPress, kind = "primary", size = "md", disabled, busy, icon, style, testID,
}: {
  title: string; onPress?: () => void; kind?: "primary" | "plain" | "ghost" | "danger" | "pill"; size?: "md" | "sm"; disabled?: boolean; busy?: boolean;
  icon?: keyof typeof Ionicons.glyphMap; style?: ViewStyle; testID?: string;
}) {
  const t = useTheme();
  const primary = kind === "primary" || kind === "pill";
  const bg = primary ? t.brand : kind === "danger" ? t.dangerSoft : kind === "ghost" ? "transparent" : t.dark ? t.surface3 : t.surface2;
  const ink = primary ? t.brandInk : kind === "danger" ? t.danger : kind === "ghost" ? t.brand : t.text;
  const small = size === "sm";
  return (
    <Pressable
      onPress={onPress ? () => { tap(primary || kind === "danger" ? "medium" : "light"); onPress(); } : undefined}
      disabled={disabled || busy}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSm,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        primary && Platform.OS !== "android" && { shadowColor: t.brand, shadowOpacity: t.dark ? 0 : 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={ink} /> : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 16 : 19} color={ink} /> : null}
          <Text style={{ color: ink, fontWeight: "700", fontSize: small ? 14 : 16, letterSpacing: -0.2 }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** A filled field; on focus it asks the page to bring it clear of the keyboard. */
export function Input(props: TextInputProps & { invalid?: boolean }) {
  const t = useTheme();
  const reveal = useReveal();
  const ref = useRef<TextInput>(null);
  const { invalid, onFocus, ...rest } = props;
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={t.muted}
      {...rest}
      onFocus={(e) => { reveal(ref.current); onFocus?.(e); }}
      style={[styles.input, { backgroundColor: t.dark ? t.surface3 : t.surface2, borderColor: invalid ? t.danger : "transparent", color: t.text }, props.style]}
    />
  );
}

export function Field({ label, help, error, children }: { label?: string; help?: string; error?: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: sp[2] }}>
      {label ? <Text style={[styles.label, { color: t.text2 }]}>{label}</Text> : null}
      {children}
      {error ? <Text style={[styles.help, { color: t.danger }]}>{error}</Text> : help ? <Text style={[styles.help, { color: t.muted }]}>{help}</Text> : null}
    </View>
  );
}

export function IconButton({ icon, onPress, color, size = 22, label, style }: { icon: keyof typeof Ionicons.glyphMap; onPress?: () => void; color?: string; size?: number; label?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }, style]}>
      <Ionicons name={icon} size={size} color={color || t.text2} />
    </Pressable>
  );
}

/** The site's segmented control: a track the chosen segment sits raised in. */
export function Segments<T extends string>({ value, onChange, options, style }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap }[]; style?: ViewStyle;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segments, { backgroundColor: t.dark ? t.surface2 : t.track }, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => { if (!on) tick(); onChange(o.value); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && { backgroundColor: t.dark ? t.surface3 : t.knob, shadowColor: "#0f1420", shadowOpacity: t.dark ? 0 : 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 }]}
          >
            {o.icon ? <Ionicons name={o.icon} size={17} color={on ? t.text : t.muted} /> : null}
            <Text style={{ color: on ? t.text : t.muted, fontWeight: "700", fontSize: 15 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small round-cornered label — a state, a count, a workplace. */
export function Chip({ children, on, colour, onPress, dot, style }: { children: React.ReactNode; on?: boolean; colour?: string; onPress?: () => void; dot?: string; style?: ViewStyle }) {
  const t = useTheme();
  const c = colour || t.brand;
  return (
    <Pressable onPress={onPress ? () => { tick(); onPress(); } : undefined} disabled={!onPress} style={({ pressed }) => [styles.chip, { backgroundColor: on ? c : t.dark ? t.surface2 : t.surface, opacity: pressed ? 0.8 : 1, ...(on || t.dark ? {} : chipShadow) }, style]}>
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? "rgba(255,255,255,0.85)" : dot }} /> : null}
      <Text style={{ color: on ? "#fff" : t.text, fontWeight: "600", fontSize: 14.5 }}>{children}</Text>
    </Pressable>
  );
}

/** A row in a menu list: icon, words, chevron — the site's .menu-row. */
export function MenuRow({ icon, title, sub, onPress, tint, last, testID }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; onPress: () => void; tint?: string; last?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable testID={testID} onPress={() => { tap("light"); onPress(); }} style={({ pressed }) => [styles.menuRow, { backgroundColor: pressed ? t.surface2 : "transparent" }]}>
      <View style={[styles.menuIcon, { backgroundColor: tint || t.brand }]}>
        <Ionicons name={icon} size={19} color="#fff" />
      </View>
      <View style={[styles.menuBody, { borderBottomColor: t.line, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontWeight: "600", fontSize: 16.5 }}>{title}</Text>
          {sub ? <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2 }}>{sub}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.lineStrong} />
      </View>
    </Pressable>
  );
}

// ---- reactions -------------------------------------------------------------------

export const EMOJI: Emoji[] = [
  { value: "👍", label: "Like" }, { value: "❤️", label: "Love" }, { value: "🥰", label: "Care" }, { value: "😂", label: "Haha" },
  { value: "😮", label: "Wow" }, { value: "😢", label: "Sad" }, { value: "😡", label: "Angry" },
];

/** The word beside a face you have left, in the face's own ink. */
export function reactionInk(emoji: string, t: ReturnType<typeof useTheme>): string {
  if (emoji === "👍") return t.rxLike;
  if (emoji === "❤️") return t.rxLove;
  if (emoji === "😡") return t.rxAngry;
  return emoji ? t.rxFace : t.text2;
}

export function EmojiRow({ mine, onPick, choices = EMOJI }: { mine: string; onPick: (emoji: string) => void; choices?: Emoji[] }) {
  const t = useTheme();
  return (
    <View style={styles.emojiRow}>
      {choices.map((e) => (
        <Pressable
          key={e.value}
          onPress={() => { tap("light"); onPick(e.value); }}
          accessibilityLabel={e.label}
          style={({ pressed }) => [styles.emoji, { backgroundColor: mine === e.value ? t.brandSoft : "transparent", transform: [{ scale: pressed ? 1.2 : 1 }] }]}
        >
          <Text style={{ fontSize: 24 }}>{e.value}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The faces stacked, the count, and who — the site's reaction tally. */
export function Tally({ tally, onPress, right }: { tally: ReactionTally; onPress?: () => void; right?: React.ReactNode }) {
  const t = useTheme();
  if (!tally.total_reactions && !right) return null;
  return (
    <View style={styles.tallyRow}>
      {tally.total_reactions ? (
        <Pressable onPress={onPress} style={styles.tally} hitSlop={6}>
          <View style={{ flexDirection: "row" }}>
            {tally.reactions.slice(0, 3).map((r, i) => (
              <View key={r.emoji} style={[styles.tallyFace, { backgroundColor: t.surface, borderColor: t.surface, marginLeft: i ? -6 : 0, zIndex: 3 - i }]}>
                <Text style={{ fontSize: 13 }}>{r.emoji}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: t.muted, fontSize: 14, flexShrink: 1 }} numberOfLines={1}>{tally.who_reacted}</Text>
        </Pressable>
      ) : <View />}
      {right}
    </View>
  );
}

const chipShadow: ViewStyle = Platform.OS === "android" ? { elevation: 1 } : { shadowColor: "#1a2540", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } };

const styles = StyleSheet.create({
  page: { paddingTop: sp[3], gap: sp[4] },
  pageHead: { marginBottom: sp[1], paddingTop: sp[2] },
  pageTitle: { fontSize: 34, fontWeight: "800", letterSpacing: -1, lineHeight: 40 },
  pageSub: { marginTop: sp[1], fontSize: 15, lineHeight: 21 },
  sectionLabel: { fontSize: 13.5, fontWeight: "700", letterSpacing: -0.1 },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: Platform.OS === "android" ? "hidden" : "visible" },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  sub: { fontSize: 13.5, lineHeight: 19 },
  body: { fontSize: 16, lineHeight: 23 },
  empty: { alignItems: "center", paddingVertical: sp[8], paddingHorizontal: sp[4] },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: sp[3] },
  emptyTitle: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  emptySub: { marginTop: sp[1], fontSize: 14, lineHeight: 20, textAlign: "center" },
  loading: { padding: sp[6], alignItems: "center" },
  alert: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3], paddingHorizontal: sp[4], borderRadius: radius.md, borderWidth: 1 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sp[2], minHeight: 52, paddingHorizontal: sp[6], borderRadius: radius.pill },
  buttonSm: { minHeight: 40, paddingHorizontal: sp[4] },
  input: { minHeight: 52, paddingHorizontal: sp[4], paddingVertical: 13, borderRadius: radius.md, borderWidth: 1.5, fontSize: 16 },
  label: { fontSize: 13.5, fontWeight: "600" },
  help: { fontSize: 13, lineHeight: 19 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  segments: { flexDirection: "row", padding: 3, borderRadius: radius.sm + 2 },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, borderRadius: radius.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill },
  menuRow: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingLeft: sp[4], minHeight: 64 },
  menuBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: sp[2], paddingVertical: sp[3], paddingRight: sp[4], minHeight: 64 },
  menuIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  emojiRow: { flexDirection: "row", justifyContent: "space-between" },
  emoji: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  tallyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[2] },
  tally: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, flexShrink: 1 },
  tallyFace: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});
