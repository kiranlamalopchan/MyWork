import { Platform, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/ui";
import { sp, useTheme, useThemeMode } from "@/ui/theme";

/** One appearance setting, using the phone's own switch and saved theme. */
export function AppearanceSetting() {
  const t = useTheme();
  const { isDark, toggle } = useThemeMode();
  return <Card>
    <View style={{ flexDirection: "row", alignItems: "center", gap: sp[3] }}>
      <Ionicons name="contrast-outline" size={23} color={t.brand} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>Dark mode</Text>
        <Text style={{ color: t.muted, fontSize: 13, marginTop: sp[1] }}>Light or dark appearance on this device</Text>
      </View>
      <Switch accessibilityLabel="Dark mode" value={isDark} onValueChange={toggle} trackColor={{ false: t.lineStrong, true: t.brand }} thumbColor={Platform.OS === "android" ? t.surface : undefined} testID="appearance-toggle" />
    </View>
  </Card>;
}
