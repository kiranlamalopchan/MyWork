import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "./index";
import { sp, useTheme } from "./theme";

/** Related destinations in one quiet surface, with a divider between rows. */
export function ProfileGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ gap: sp[2] }}>
    {title ? <Text accessibilityRole="header" style={{ color: t.muted, fontSize: 13, fontWeight: "600", paddingHorizontal: sp[3] }}>{title}</Text> : null}
    <Card pad={false} style={{ overflow: "hidden" }}>
      {React.Children.toArray(children).map((child, index) => <React.Fragment key={React.isValidElement(child) && child.key != null ? child.key : index}>
        {index ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginLeft: 60, marginRight: 22 }} /> : null}
        {child}
      </React.Fragment>)}
    </Card>
  </View>;
}
