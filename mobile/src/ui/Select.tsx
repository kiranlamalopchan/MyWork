/**
 * One choice from a short list, made with the phone's own control: on
 * Android the system dropdown (@react-native-picker/picker in "dropdown"
 * mode), on iOS the picker wheel in a sheet that slides up from the foot
 * of the screen, on the web the browser's <select>. A build without the
 * picker module falls back to a row of chips, so the screen still works.
 */
import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Chip } from "./index";
import { tick } from "./haptics";
import { nativeOrNull } from "./native";
import { radius, sp, useTheme } from "./theme";

export type Option = { value: string; label: string };

type PickerModule = typeof import("@react-native-picker/picker");

export function Select({ value, options, onChange, label, testID }: { value: string; options: Option[]; onChange: (value: string) => void; label?: string; testID?: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const Picker = nativeOrNull(() => (require("@react-native-picker/picker") as PickerModule).Picker);
  const chosen = options.find((o) => o.value === value);
  const fill = t.dark ? t.surface3 : t.surface2;
  const pick = (next: string) => { if (next !== value) { tick(); onChange(next); } };

  if (!Picker) {
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }} testID={testID}>
        {options.map((o) => <Chip key={o.value} on={o.value === value} onPress={() => pick(o.value)}>{o.label}</Chip>)}
      </View>
    );
  }

  if (Platform.OS === "ios") {
    return (
      <View>
        <Pressable onPress={() => { tick(); setOpen(true); }} accessibilityRole="button" accessibilityLabel={label ? `${label}: ${chosen?.label ?? value}` : chosen?.label ?? value} testID={testID} style={({ pressed }) => [styles.field, { backgroundColor: fill, opacity: pressed ? 0.8 : 1 }]}>
          <Text style={[styles.value, { color: t.text }]} numberOfLines={1}>{chosen?.label ?? value}</Text>
          <Ionicons name="chevron-expand-outline" size={18} color={t.muted} />
        </Pressable>
        <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0, 0, 0, 0.28)" }]} onPress={() => setOpen(false)} accessibilityLabel="Close" />
          <View style={[styles.sheet, { backgroundColor: t.surface }]}>
            <View style={[styles.sheetBar, { borderBottomColor: t.line }]}>
              <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{label ?? "Choose"}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={{ color: t.brand, fontWeight: "700", fontSize: 16 }}>Done</Text>
              </Pressable>
            </View>
            <Picker selectedValue={value} onValueChange={(v: string) => pick(String(v))} itemStyle={{ color: t.text }}>
              {options.map((o) => <Picker.Item key={o.value} label={o.label} value={o.value} color={t.text} />)}
            </Picker>
          </View>
        </Modal>
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
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: sp[8], marginTop: "auto" },
  sheetBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: sp[5], paddingVertical: sp[4], borderBottomWidth: StyleSheet.hairlineWidth },
});
