import React from "react";
import type { ScrollViewProps } from "react-native";
import { Page } from "./index";
import { useLayout } from "./layout";

/**
 * Work sections render immediately, including when returning to a mounted tab.
 * `wide`: a page laid out in two columns (Split) takes the hub's width on a
 * wide screen, not the single column's.
 */
export function WorkPage({ children, wide, contentContainerStyle, ...props }: ScrollViewProps & { children: React.ReactNode; wide?: boolean }) {
  const layout = useLayout();
  return <Page {...props} contentContainerStyle={[wide && layout.desk ? layout.hub : null, contentContainerStyle]}>{children}</Page>;
}
