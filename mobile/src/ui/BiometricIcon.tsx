/**
 * The two marks a phone's lock goes by: the Face ID face inside its four
 * corners, and a fingerprint's whorl — drawn here as strokes so they
 * match at any size and colour. Which one shows follows what the phone
 * has (auth/biometric's `kind`): a face where there is face unlock, the
 * print where there is only a reader.
 */
import React from "react";
import Svg, { Path } from "react-native-svg";

import type { BiometricKind } from "@/auth/biometric";

const FACE = [
  // The four corners.
  "M3 8.5V6a3 3 0 0 1 3-3h2.5",
  "M15.5 3H18a3 3 0 0 1 3 3v2.5",
  "M21 15.5V18a3 3 0 0 1-3 3h-2.5",
  "M8.5 21H6a3 3 0 0 1-3-3v-2.5",
  // Eyes, nose, smile.
  "M8.3 8.6v1.8",
  "M15.7 8.6v1.8",
  "M12.7 8.6v4.6a1 1 0 0 1-1 1",
  "M8.3 15.4c1 1.1 2.25 1.7 3.7 1.7s2.7-.6 3.7-1.7",
];

// The print: three loops over the top, their ridges running down, each
// ending where a ridge would break.
const PRINT = [
  "M5 20.5V11.5a7 7 0 0 1 14 0V16",
  "M8.2 18V11.5a3.8 3.8 0 0 1 7.6 0V20.5",
  "M11.5 21V11.8a.5.5 0 0 1 1 0V15",
  "M19 19.2V21",
  "M8.2 20.7v.3",
];

export function BiometricIcon({ kind, size = 22, color }: { kind: BiometricKind; size?: number; color: string }) {
  const paths = kind === "fingerprint" ? PRINT : FACE;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {paths.map((d) => <Path key={d} d={d} stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />)}
    </Svg>
  );
}
