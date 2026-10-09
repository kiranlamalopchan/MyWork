import { View } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { useTheme } from "@/ui/theme";
import { clockHands } from "./clockHands";

export function AnalogClock({ timestamp, size }: { timestamp: number; size: number }) {
  const t = useTheme();
  const hands = clockHands(timestamp);
  return <View accessibilityRole="image" accessibilityLabel={`Clock showing ${new Date(timestamp).toLocaleTimeString()}`} style={{ width: size, height: size, alignSelf: "center", shadowColor: t.shadow, shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}>
    <Svg width={size} height={size} viewBox="0 0 240 240">
      <Defs><LinearGradient id="bezel" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={t.dark ? "#66786e" : "#edf2ed"} /><Stop offset="0.45" stopColor={t.dark ? "#273e32" : "#becdc2"} /><Stop offset="1" stopColor={t.dark ? "#5c7164" : "#e3ebe5"} /></LinearGradient></Defs>
      <Circle cx="120" cy="120" r="117" fill="url(#bezel)" stroke={t.lineStrong} />
      <Circle cx="120" cy="120" r="109" fill={t.surface} stroke={t.dark ? "#09160e" : "#a7b9ac"} strokeWidth="2" />
      <Circle cx="120" cy="120" r="105" fill="none" stroke={t.line} />
      {Array.from({ length: 60 }, (_, i) => <Line key={i} x1="120" y1={i % 5 ? 20 : 18} x2="120" y2={i % 5 ? 24 : 30} stroke={i % 5 ? t.muted : t.text} strokeWidth={i % 5 ? 1 : 2.4} transform={`rotate(${i * 6} 120 120)`} />)}
      {Array.from({ length: 12 }, (_, i) => {
        const n = i + 1, angle = n * Math.PI / 6;
        return <SvgText key={n} x={120 + 78 * Math.sin(angle)} y={120 - 78 * Math.cos(angle) + 6} fill={t.text} textAnchor="middle" fontSize={n % 3 ? 15 : 18} fontWeight={n % 3 ? "500" : "700"}>{n}</SvgText>;
      })}
      <SvgText x="120" y="83" textAnchor="middle" fontSize="7" letterSpacing="1.3" fill={t.muted}>KAAMKORECORD</SvgText>
      <SvgText x="120" y="161" textAnchor="middle" fontSize="7" letterSpacing="1.6" fill={t.muted}>LOCAL TIME</SvgText>
      <G transform={`rotate(${hands.hour} 120 120)`}><Path d="M116 133 L116 84 L120 65 L124 84 L124 133 Z" fill={t.text} /><Line x1="120" y1="78" x2="120" y2="111" stroke={t.surface} strokeWidth="1" /></G>
      <G transform={`rotate(${hands.minute} 120 120)`}><Path d="M117.5 139 L117.5 53 L120 38 L122.5 53 L122.5 139 Z" fill={t.text} /><Line x1="120" y1="52" x2="120" y2="111" stroke={t.surface} strokeWidth="1" /></G>
      <G transform={`rotate(${hands.second} 120 120)`}><Line x1="120" y1="149" x2="120" y2="28" stroke={t.brand} strokeWidth="1.5" /><Circle cx="120" cy="142" r="4" fill={t.surface} stroke={t.brand} strokeWidth="1.5" /></G>
      <Circle cx="120" cy="120" r="5" fill={t.brand} /><Circle cx="120" cy="120" r="2" fill={t.surface} />
    </Svg>
  </View>;
}
