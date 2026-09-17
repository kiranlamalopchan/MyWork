/**
 * One choice from a short list, made with the phone's own control.
 *
 * iOS opens the system action sheet (ActionSheetIOS, from React Native
 * itself): the list arrives over the screen in the platform's own type, with
 * its own blur, dismiss gesture and dark mode, and the one you are on is
 * ticked. It replaced a spinning wheel in a sheet of our own — the wheel is
 * the control iOS uses for a date, not for eight names, and dragging one to
 * "Western Australia" is slower than reading a list.
 *
 * Android keeps the system dropdown (@react-native-picker/picker in
 * "dropdown" mode), which is already that platform's modern control, and the
 * web keeps the browser's <select>. A build without the picker module falls
 * back to a row of chips, so the screen still works.
 */
import React from "react";
import { ActionSheetIOS, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Chip } from "./index";
import { rowValue, sheetRows, type Option } from "./choose";
import { tick } from "./haptics";
import { nativeOrNull } from "./native";
import { radius, sp, useTheme } from "./theme";

export type { Option } from "./choose";

type PickerModule = typeof import("@react-native-picker/picker");

export function Select({ value, options, onChange, label, testID }: { value: string; options: Option[]; onChange: (value: string) => void; label?: string; testID?: string }) {
  const t = useTheme();
  const Picker = nativeOrNull(() => (require("@react-native-picker/picker") as PickerModule).Picker);
  const chosen = options.find((o) => o.value === value);
  const fill = t.dark ? t.surface3 : t.surface2;
  const pick = (next: string) => { if (next !== value) { tick(); onChange(next); } };

  if (Platform.OS === "ios") {
    // An action sheet has no idea which row is the current one, so the tick
    // is ours — without it the list is eight names and no answer.
    const open = () => {
      tick();
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: label,
          options: sheetRows(options, value),
          cancelButtonIndex: options.length,
          userInterfaceStyle: t.dark ? "dark" : "light",
        },
        (index) => { const next = rowValue(options, index); if (next !== null) pick(next); },
      );
    };
    return (
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityHint="Opens a list to choose from"
        accessibilityLabel={label ? `${label}: ${chosen?.label ?? value}` : chosen?.label ?? value}
        testID={testID}
        style={({ pressed }) => [styles.field, { backgroundColor: fill, opacity: pressed ? 0.8 : 1 }]}
      >
        <Text style={[styles.value, { color: t.text }]} numberOfLines={1}>{chosen?.label ?? value}</Text>
        <Ionicons name="chevron-expand-outline" size={18} color={t.muted} />
      </Pressable>
    );
  }

  if (!Picker) {
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }} testID={testID}>
        {options.map((o) => <Chip key={o.value} on={o.value === value} onPress={() => pick(o.value)}>{o.label}</Chip>)}
      </View>
    );
  }

  // Android's dropdown, and the browser's select, sit in the field themselves.
  return (
    <View style={[styles.field, { backgroundColor: fill, paddingHorizontal: Platform.OS === "web" ? 0 : sp[2] }]} testID={testID}>
      <Picker
        selectedValue={value}
        onValueChange={(v: string) => pick(String(v))}
        mode="dropdown"
        dropdownIconColor={t.text2}
        accessibilityLabel={label}
        style={[styles.picker, { color: t.text }, Platform.OS === "web" ? { backgroundColor: fill, paddingHorizontal: sp[4], fontSize: 16, borderWidth: 0, borderRadius: radius.md } : null]}
      >
        {options.map((o) => <Picker.Item key={o.value} label={o.label} value={o.value} color={t.text} style={{ backgroundColor: t.surface }} />)}
      </Picker>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 50, borderRadius: radius.md, paddingHorizontal: sp[4], flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[2] },
  value: { fontSize: 16, fontWeight: "600", flex: 1 },
  picker: { flex: 1, height: 50 },
});
