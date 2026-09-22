/**
 * The drawing shown in place of a network error.
 *
 * Signal arcs climbing away from a dot, struck through: the phone is trying
 * to reach something and not getting there. Drawn in the muted greys rather
 * than the danger red — nothing has gone wrong with anybody's data, and a
 * red page for standing in a cool room with no bars reads as a fault when
 * it is only a fact.
 *
 * The same viewBox as HolidayArt so the two sit at the same weight, and
 * decoration only: the words beside it say everything it says.
 */
import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

import { alpha, useTheme } from "@/ui/theme";

export function OfflineArt() {
  const t = useTheme();
  const wash = alpha(t.muted, 0.13);
  const doodle = alpha(t.muted, 0.42);
  const ink = t.muted;

  return (
    <Svg width="100%" height="100%" viewBox="0 0 160 150" fill="none" accessible={false}>
      <Circle cx={80} cy={74} r={62} fill={wash} />

      {/* Three arcs over a dot. The outer two are dashed: the signal thins
          out the further from the phone it has to travel. */}
      <Path d="M40 72q40-38 80 0" stroke={doodle} strokeWidth={5} strokeLinecap="round" strokeDasharray="15 12" />
      <Path d="M54 88q26-25 52 0" stroke={doodle} strokeWidth={5} strokeLinecap="round" strokeDasharray="13 10" />
      <Path d="M67 103q13-13 26 0" stroke={ink} strokeWidth={5} strokeLinecap="round" />
      <Circle cx={80} cy={117} r={6} fill={ink} />

      {/* Struck through, corner to corner. */}
      <Path d="M36 122 124 34" stroke={ink} strokeWidth={5.5} strokeLinecap="round" />

      <Circle cx={22} cy={44} r={3.5} fill={doodle} />
      <Circle cx={140} cy={108} r={3} fill={doodle} />
    </Svg>
  );
}
