/**
 * The drawing beside the next public holiday (templates/holidays/_art.html).
 *
 * A calendar with the day ringed, a sun over it and a leaf growing past it:
 * a day that is on the calendar and is not a work day. The same geometry as
 * the site's, in the same viewBox, so the two cards are one design — change
 * a coordinate here and change it there.
 *
 * Decoration only. Everything it says the card says in words beside it, so
 * it is hidden from the screen reader rather than described.
 */
import React from "react";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

import { alpha, useTheme } from "@/ui/theme";

export function HolidayArt() {
  const t = useTheme();
  const wash = alpha(t.brand, 0.13);
  const doodle = alpha(t.brand, 0.34);

  return (
    <Svg width="100%" height="100%" viewBox="0 0 160 150" fill="none" accessible={false}>
      <Circle cx={82} cy={74} r={70} fill={wash} />

      <Path d="M8 52q9-11 18 0t18 0" stroke={doodle} strokeWidth={3.5} strokeLinecap="round" />
      <Path d="M132 16q8-10 16 0" stroke={doodle} strokeWidth={3.5} strokeLinecap="round" />
      <Circle cx={14} cy={100} r={3.5} fill={doodle} />
      <Circle cx={152} cy={58} r={4} fill={doodle} />
      <Circle cx={140} cy={136} r={3} fill={doodle} />

      <Circle cx={30} cy={30} r={12} fill={t.warn} />
      <Path
        d="M13 30H7M30 13V7M18 42l-4.3 4.3M18 18l-4.3-4.3M42 18l4.3-4.3"
        stroke={t.warn}
        strokeWidth={3.5}
        strokeLinecap="round"
      />

      {/* Tilted a few degrees: a page pinned up, not a box ruled on the screen. */}
      <G rotation={-4} originX={98} originY={78}>
        <Rect x={52} y={36} width={92} height={84} rx={12} fill={t.surface} />
        <Path d="M64 36h68a12 12 0 0 1 12 12v12H52V48a12 12 0 0 1 12-12Z" fill={t.brandStrong} />
        <Rect x={72} y={27} width={8} height={19} rx={4} fill={t.brandStrong} />
        <Rect x={116} y={27} width={8} height={19} rx={4} fill={t.brandStrong} />

        {/* Five plain days and one ringed — the middle of the second row is
            left out so the disc sits in a gap rather than on top of a square. */}
        <Rect x={64} y={70} width={18} height={12} rx={3.5} fill={alpha(t.text, 0.13)} />
        <Rect x={88} y={70} width={18} height={12} rx={3.5} fill={alpha(t.text, 0.13)} />
        <Rect x={112} y={70} width={18} height={12} rx={3.5} fill={alpha(t.text, 0.13)} />
        <Rect x={64} y={90} width={18} height={12} rx={3.5} fill={alpha(t.text, 0.13)} />
        <Rect x={112} y={90} width={18} height={12} rx={3.5} fill={alpha(t.text, 0.13)} />
        <Circle cx={97} cy={96} r={14} fill={t.brand} />
        <Path
          d="m90.5 96 4.5 4.5L104.5 90"
          stroke={t.surface}
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>

      <Path d="M16 146c8-16 12-30 12-42" stroke={t.brandStrong} strokeWidth={3.5} strokeLinecap="round" />
      <Path d="M28 106C12 102 6 86 12 70c18 2 26 20 16 36Z" fill={t.brand} />
      <Path d="M26 102 15 76" stroke={t.surface} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      <Path d="M32 112c16-6 20-22 12-36-16 6-20 22-12 36Z" fill={t.brand} />
      <Path d="M32 108 42 82" stroke={t.surface} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
    </Svg>
  );
}
