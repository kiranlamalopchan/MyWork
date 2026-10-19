import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, sp, useTheme } from "./theme";

type Action = { label: string; accessibilityLabel?: string; icon: keyof typeof Ionicons.glyphMap; destructive?: boolean; onPress: () => void };

/** An anchored overflow menu that stays inside the phone's viewport. */
export function ActionMenu({ label, actions, disabled, trigger: customTrigger, triggerStyle }: { label: string; actions: Action[]; disabled?: boolean; trigger?: React.ReactNode; triggerStyle?: StyleProp<ViewStyle> }) {
  const t = useTheme(), { width, height } = useWindowDimensions();
  const trigger = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const menuWidth = Math.min(200, width - 32), menuHeight = actions.length * 48 + 10;
  const [position, setPosition] = useState({ left: 16, top: 64 });
  const visiblePosition = {
    left: Math.max(16, Math.min(position.left, width - menuWidth - 16)),
    top: Math.max(16, Math.min(position.top, height - menuHeight - 16)),
  };
  useEffect(() => setOpen(false), [width, height]);
  const close = () => setOpen(false);
  const show = () => {
    setOpen(true);
    trigger.current?.measureInWindow((x, y, w, h) => setPosition({
      left: Math.max(16, Math.min(x + w - menuWidth, width - menuWidth - 16)),
      top: y + h + menuHeight + 6 <= height - 16 ? y + h + 6 : Math.max(16, y - menuHeight - 6),
    }));
  };
  return <>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open, disabled: !!disabled }} disabled={disabled}
      onPress={show} style={({ pressed }) => [styles.trigger, triggerStyle, { opacity: disabled ? .5 : 1, backgroundColor: pressed || open ? t.surface2 : "transparent" }]}>
      {customTrigger || <Ionicons name="ellipsis-horizontal" size={22} color={t.text2} />}
    </Pressable>
    {open ? <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <View style={StyleSheet.absoluteFill} accessibilityViewIsModal onAccessibilityEscape={close}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close actions menu" onPress={close} style={StyleSheet.absoluteFill} />
      <View accessibilityRole="menu" accessibilityLabel={label} style={[styles.menu, visiblePosition, { width: menuWidth, backgroundColor: t.surface, borderColor: t.lineStrong }]}>
        {actions.map((action, index) => <Pressable key={action.label} accessibilityRole="menuitem" accessibilityLabel={action.accessibilityLabel || action.label}
          onPress={() => { close(); action.onPress(); }} style={({ pressed }) => [styles.item, pressed && { backgroundColor: t.surface2 }]}>
          <Ionicons name={action.icon} size={18} color={action.destructive ? t.danger : t.text2} />
          <Text style={{ color: action.destructive ? t.danger : t.text, fontSize: 15, fontWeight: "600" }}>{action.label}</Text>
        </Pressable>)}
      </View>
      </View>
    </Modal> : null}
  </>;
}

const styles = StyleSheet.create({
  trigger: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  menu: { position: "absolute", padding: 4, borderRadius: radius.md, borderWidth: 1, elevation: 8, shadowColor: "#000", shadowOpacity: .18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  item: { minHeight: 48, paddingHorizontal: sp[3], flexDirection: "row", alignItems: "center", gap: sp[3], borderRadius: radius.sm },
});
