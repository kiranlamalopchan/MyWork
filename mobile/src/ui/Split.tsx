/**
 * Two columns side by side on an iPad, one after the
 * other on a phone. On a phone the two sides simply join the page's own
 * column, spaced like everything else on it; on a wide screen each side is a
 * column of its own, so a page of figures reads like a dashboard instead of
 * one long strip down the middle of an empty screen.
 */
import React from "react";
import { StyleSheet, View } from "react-native";

import { useLayout } from "./layout";
import { sp } from "./theme";

export function Split({ main, side, testID }: { main: React.ReactNode; side: React.ReactNode; testID?: string }) {
  const layout = useLayout();
  if (!layout.desk) return <>{main}{side}</>;
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.column}>{main}</View>
      <View style={styles.column}>{side}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: sp[6] },
  column: { flex: 1, minWidth: 0, gap: sp[4] },
});
