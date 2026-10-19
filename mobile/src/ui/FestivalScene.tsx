import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";

type Kind = "bowl" | "diya" | "flower" | "snow" | "tree" | "star" | "burst" | "butterfly" | "egg" | "powder" | "flags" | "nepal" | "sun" | "ripple" | "lotus" | "bell" | "incense" | "thread" | "flute" | "feather" | "lantern" | "confetti";
type Effect = "still" | "float" | "glow" | "swing" | "fall" | "burst" | "flutter";
type Item = { kind: Kind; x: number; y: number; size: number; effect?: Effect; colour?: string };
const item = (kind: Kind, x: number, y: number, size: number, effect: Effect = "float", colour?: string): Item => ({ kind, x, y, size, effect, colour });
const sparkle = [item("star", 10, 10, 9, "glow"), item("star", 63, 7, 7, "glow"), item("star", 78, 45, 6, "glow")];

/** Every scene uses recognisable festival objects; particles complement the main subject. */
export function festivalScene(id: string, motion: string): Item[] {
  if (id === "dashain" || motion === "kites") return [item("flower", 4, 9, 9, "fall"), item("flower", 70, 4, 8, "fall"), item("flower", 44, 26, 7, "fall")];
  if (motion === "lights") return [item("diya", 1, 47, 38, "glow"), item("diya", 35, 38, 46, "glow"), item("diya", 70, 51, 34, "glow"), item("flower", 10, 5, 11, "fall"), item("flower", 65, 0, 10, "fall"), ...sparkle];
  if (motion === "snow") return [item("tree", 33, 15, 77, "still"), ...Array.from({ length: 6 }, (_, i) => item("snow", i * 15, i % 3 * 15, 7 + i % 2 * 3, "fall")), ...sparkle];
  if (motion === "fireworks") return [item("burst", 5, 9, 48, "burst", "#ffdb83"), item("burst", 48, 0, 54, "burst", "#afebe2"), item("burst", 35, 46, 35, "burst", "#f7adc6"), item("confetti", 74, 13, 11, "fall"), item("confetti", 19, 25, 9, "fall")];
  if (motion === "butterflies") return [item("egg", 17, 49, 29, "still", "#e6b6da"), item("egg", 55, 55, 25, "still", "#f4d486"), item("butterfly", 8, 10, 32, "flutter"), item("butterfly", 56, 20, 27, "flutter", "#e9c36a"), item("flower", 35, 0, 9, "fall")];
  if (motion === "colour") return [item("powder", 0, 24, 63, "burst", "#ff70b0"), item("powder", 40, 4, 57, "burst", "#75dbef"), item("powder", 49, 46, 53, "burst", "#ffd46b"), ...Array.from({ length: 4 }, (_, i) => item("confetti", 10 + i * 20, 7, 8, "fall", ["#ff70b0", "#75dbef", "#ffd46b", "#bc9ef4"][i]))];
  if (motion === "flags") return [item(id === "nepali-new-year" ? "nepal" : "flags", 14, -5, 105, "swing"), ...sparkle];
  if (id === "maghe-sankranti") return [item("sun", -12, 18, 45, "glow"), item("bowl", 10, 48, 62, "still"), item("flower", 76, 45, 12, "float")];
  if (motion === "sun") return [item("sun", 24, 6, 56, "glow"), item("ripple", 14, 57, 79, "float"), item("ripple", 25, 72, 65, "glow")];
  if (motion === "water") return [item("thread", 22, 25, 65, "float"), ...sparkle];
  if (motion === "petals") return [item("lotus", 23, 35, 65, "glow"), ...Array.from({ length: 5 }, (_, i) => item("flower", i * 19, i % 2 * 12, 8 + i % 2 * 3, "fall", "#f6bfd0"))];
  if (motion === "bell") return [item("bell", 34, -3, 62, "swing"), item("incense", 0, 43, 40, "float"), item("incense", 68, 47, 30, "float")];
  if (motion === "feather") return [item("feather", 33, 1, 65, "float"), item("flute", 5, 49, 85, "swing"), ...sparkle];
  if (motion === "lantern") return [item("star", 1, 5, 12, "glow"), item("lantern", 38, -10, 58, "swing"), item("lantern", 74, 4, 39, "swing"), ...sparkle];
  return Array.from({ length: 7 }, (_, i) => item("confetti", i * 12, i % 3 * 9, 8 + i % 3 * 3, "fall", ["#f6c96e", "#f6b2d1", "#99e2d5"][i % 3]));
}

function Glyph({ kind, colour = "#ffe2a0" }: { kind: Kind; colour?: string }) {
  switch (kind) {
    case "bowl": return <><Path d="M8 57Q50 113 92 57Z" fill="#a76f3f" stroke="#efd3a1" strokeWidth="3" /><Ellipse cx="50" cy="57" rx="42" ry="10" fill="#d3a873" />{[25,43,61,76].map((x,i)=><G key={x}><Circle cx={x} cy={i%2?45:49} r="11" fill="#b77b42" /><Path d={`M${x-4} 44h2m3 4h2m-5 5h2`} stroke="#ffe5b0" strokeWidth="2" /></G>)}</>;
    case "diya": return <><Circle cx="50" cy="37" r="29" fill="#ffc363" opacity=".13" /><Path d="M12 62Q50 108 88 62Z" fill="#ce6f32" stroke="#ffc779" strokeWidth="3" /><Ellipse cx="50" cy="62" rx="38" ry="6" fill="#f5b756" /><Path d="M50 58C22 44 49 24 52 8 71 33 74 46 50 58Z" fill="#ffbf45" /><Path d="M50 57Q38 44 51 28 64 46 50 57" fill="#fff3b6" /></>;
    case "flower": return <G fill={colour === "#ffe2a0" ? "#f5ae49" : colour}>{[0, 60, 120, 180, 240, 300].map(a => <Ellipse key={a} cx="50" cy="28" rx="15" ry="24" transform={`rotate(${a} 50 50)`} />)}<Circle cx="50" cy="50" r="15" fill="#f8c86c" /></G>;
    case "snow": return <Path d="M50 5V95M11 27 89 73M11 73 89 27M50 5 38 19M50 5 62 19M50 95 38 81M50 95 62 81" stroke="#fff" strokeWidth="6" strokeLinecap="round" />;
    case "tree": return <><Rect x="44" y="76" width="12" height="19" fill="#b48450" /><Path d="M50 14 20 48H34L12 74H88L67 48H80Z" fill="#25745a" stroke="#94c7a0" strokeWidth="2" /><Path d="m50 0 4 9 10 1-8 7 2 10-8-5-9 5 2-10-7-7 10-1Z" fill="#ffe7a2" />{[ [38,40], [60,55], [31,66], [66,71] ].map(([cx,cy]) => <Circle key={cx} cx={cx} cy={cy} r="4" fill="#f4c87b" />)}</>;
    case "star": return <Path d="m50 1 9 35 35 14-35 12-9 37-12-37L3 50l35-14Z" fill={colour} />;
    case "burst": return <G stroke={colour} strokeWidth="3" strokeLinecap="round">{Array.from({ length: 12 }, (_, i) => <Path key={i} d="M50 25V4M50 31V29" transform={`rotate(${i * 30} 50 50)`} />)}</G>;
    case "butterfly": return <><Path d="M49 48C4 0-9 62 45 55 2 90 43 105 50 61 60 106 100 87 56 54 109 61 98 0 51 48" fill={colour === "#ffe2a0" ? "#f2bbd8" : colour} /><Path d="M50 43V67M50 44 43 34M50 44 57 34" stroke="#6a3f66" strokeWidth="3" strokeLinecap="round" /></>;
    case "egg": return <><Path d="M50 8C24 8 12 50 13 69 15 105 85 105 87 69 88 49 76 8 50 8Z" fill={colour} /><Path d="m17 59 17 10 16-10 16 10 18-10M25 35H75" stroke="#fff4dc" strokeWidth="6" fill="none" /></>;
    case "powder": return <G fill={colour}><Circle cx="50" cy="49" r="31" opacity=".35" /><Circle cx="30" cy="38" r="24" opacity=".45" /><Circle cx="68" cy="63" r="23" opacity=".4" /><Circle cx="18" cy="14" r="4" /><Circle cx="88" cy="37" r="3" /><Circle cx="75" cy="9" r="5" /></G>;
    case "flags": return <><Path d="M1 13Q50 45 99 13" stroke="#f3e3b1" strokeWidth="1" fill="none" />{["#4699c8", "#fff2d6", "#e75a50", "#60b886", "#f1c655"].map((c,i) => <G key={c} transform={`translate(${5+i*18} ${18+Math.sin(i/4*Math.PI)*12}) rotate(${8-i*4})`}><Rect width="15" height="24" fill={c} /><Path d="M4 7H11M4 11H11M4 15H9" stroke="#725e55" opacity=".5" /></G>)}</>;
    case "nepal": return <><Path d="M20 5V95" stroke="#e0b879" strokeWidth="3" /><Path d="M23 8 75 41H39L81 77H23Z" fill="#e54b53" stroke="#385e9c" strokeWidth="4" /><Circle cx="35" cy="30" r="5" fill="#fff1d8" /><Path d="m38 52 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#fff1d8" /></>;
    case "sun": return <><Circle cx="50" cy="50" r="43" fill="#ffc97c" opacity=".12" /><Circle cx="50" cy="50" r="28" fill="#ffdc8c" opacity=".1" />{Array.from({length:12},(_,i)=><Path key={i} d="M50 6V14" stroke="#ffd797" opacity=".22" strokeWidth="3" strokeLinecap="round" transform={`rotate(${i*30} 50 50)`} />)}</>;
    case "ripple": return <Path d="M10 10H90M22 25H79M3 40H97M25 56H72M14 74H88" stroke="#ffe2a0" strokeWidth="2" strokeLinecap="round" opacity=".7" />;
    case "lotus": return <><Ellipse cx="50" cy="80" rx="41" ry="8" fill="#f6d9ad" opacity=".2" /><Path d="M50 77Q15 71 9 37 43 37 50 77M50 77Q85 71 91 37 57 37 50 77" fill="#eb95b3" /><Path d="M50 78Q22 45 50 9 78 45 50 78" fill="#f8bfd1" /><Path d="M50 78Q15 94 7 65 32 54 50 78M50 78Q85 94 93 65 68 54 50 78" fill="#f9d9df" /></>;
    case "bell": return <><Path d="M50 0V20" stroke="#dfb973" strokeWidth="3" /><Circle cx="50" cy="79" r="7" fill="#f1cb7b" /><Path d="M22 74H78L69 65V43Q69 22 50 22 31 22 31 43V65Z" fill="#dba655" stroke="#ffe2a0" strokeWidth="2" /><Path d="M39 43Q39 31 47 31" stroke="#ffe8b4" strokeWidth="4" fill="none" /></>;
    case "incense": return <><Path d="M50 91V65" stroke="#bb894f" strokeWidth="3" /><Path d="M50 65C81 46 24 41 51 21S44 4 52 0" stroke="#e4d5c2" strokeWidth="3" fill="none" opacity=".6" /></>;
    case "thread": return <><Ellipse cx="50" cy="49" rx="30" ry="36" fill="none" stroke="#fff2cc" strokeWidth="5" /><Ellipse cx="50" cy="49" rx="25" ry="33" fill="none" stroke="#e6bc6c" strokeWidth="2" /><Path d="M23 62 74 39M25 69 77 46" stroke="#df6652" strokeWidth="3" /><Path d="M68 45 91 57M69 47 87 70" stroke="#ffe8af" strokeWidth="3" /><Circle cx="68" cy="46" r="5" fill="#dd7258" /></>;
    case "flute": return <G transform="rotate(-18 50 50)"><Rect x="6" y="43" width="88" height="13" rx="5" fill="#d9a45b" stroke="#ffe5a1" strokeWidth="2" />{[25,39,53,67,81].map(x => <Circle key={x} cx={x} cy="49" r="2" fill="#664926" />)}<Path d="M16 41V58M20 41V58" stroke="#dc6a51" strokeWidth="2" /></G>;
    case "feather": return <><Path d="M28 94Q1 19 55 4 104 25 67 72Z" fill="#45a58a" /><Ellipse cx="52" cy="36" rx="19" ry="24" fill="#d8b76b" /><Ellipse cx="52" cy="36" rx="12" ry="17" fill="#4685a4" /><Ellipse cx="52" cy="36" rx="6" ry="10" fill="#243d70" /><Path d="M28 94 53 20" stroke="#e5d094" strokeWidth="2" /></>;
    case "lantern": return <><Path d="M50 0V21" stroke="#e9c886" strokeWidth="2" /><Circle cx="50" cy="57" r="36" fill="#ffd888" opacity=".1" /><Path d="M28 37 50 24 72 37V77L50 89 28 77Z" fill="#dca754" stroke="#fff1c1" strokeWidth="2" /><Path d="M39 42H61V73H39Z" fill="#ffedb1" /><Path d="M28 38H72M28 77H72" stroke="#f9d88a" strokeWidth="3" /></>;
    case "confetti": return <Path d="m20 10 23 33M65 45 10 82M68 72 88 93" stroke={colour} strokeWidth="12" strokeLinecap="round" />;
  }
}

export function FestivalScene({ id, motion, animate, compact }: { id: string; motion: string; animate: boolean; compact: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    if (!animate) return;
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true, isInteraction: false }));
    loop.start(); return () => loop.stop();
  }, [animate, progress, id, motion]);
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} testID={`festival-scene-${id}`}>
    <View style={{ position: "absolute", right: "1%", top: 0, bottom: 0, width: "43%" }}>
      {festivalScene(id, motion).map((part, index) => {
        // Offset a single native clock: all objects have independent phases without JS timers.
        const phase = Animated.modulo(Animated.add(progress, index * .173), 1);
        const wave = (outputRange: number[]) => phase.interpolate({ inputRange: [0, .5, 1], outputRange });
        const fall = part.effect === "fall", burst = part.effect === "burst";
        const transform = part.effect === "still" ? [] : [
          { translateX: wave([0, part.effect === "float" ? 5 : -3, 0]) },
          { translateY: fall ? phase.interpolate({ inputRange: [0, 1], outputRange: [-16, compact ? 100 : 220] }) : wave([0, -5, 0]) },
          { rotate: phase.interpolate({ inputRange: [0, .5, 1], outputRange: part.effect === "swing" ? ["-7deg", "7deg", "-7deg"] : ["-3deg", "4deg", "-3deg"] }) },
          { scale: burst ? phase.interpolate({ inputRange: [0, .5, 1], outputRange: [.25, 1.15, .25] }) : wave([1, part.effect === "glow" ? 1.07 : 1, 1]) },
          { scaleX: part.effect === "flutter" ? wave([.6, 1, .6]) : 1 },
        ];
        const opacity = fall || burst ? phase.interpolate({ inputRange: [0, .15, .65, 1], outputRange: [0, .8, .75, 0] }) : part.effect === "glow" ? wave([.72, 1, .72]) : 1;
        const size = part.size * (compact ? 1 : 2.1);
        return <Animated.View key={`${id}-${index}`} testID={`festival-object-${part.kind}`} style={{ position: "absolute", left: `${part.x}%`, top: `${part.y}%`, width: size, height: size, opacity: animate ? opacity : 1, transform: animate ? transform : [], transformOrigin: part.effect === "swing" ? "50% 0%" : "50% 50%" }}>
          <Svg width="100%" height="100%" viewBox="0 0 100 100"><Glyph kind={part.kind} colour={part.colour} /></Svg>
        </Animated.View>;
      })}
    </View>
  </View>;
}
