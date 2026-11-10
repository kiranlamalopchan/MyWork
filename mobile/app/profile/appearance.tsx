import React from "react";
import { useT } from "@/i18n";
import { Card, Page, PageTitle, Screen } from "@/ui";
import { AppearanceSetting } from "@/ui/AppearanceSetting";
import { LanguageSetting } from "@/ui/WorkAlarmSettings";

export default function Appearance() {
  const tr = useT();
  return <Screen back backLabel={tr("Settings")}>
    <Page>
      <PageTitle>{tr("Appearance")}</PageTitle>
      <Card pad={false} style={{ overflow: "hidden" }}>
        <AppearanceSetting minimal />
        <LanguageSetting />
      </Card>
    </Page>
  </Screen>;
}
