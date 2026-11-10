import React from "react";
import { useT } from "@/i18n";
import { Card, Page, PageTitle, Screen } from "@/ui";
import { PushRow } from "@/ui/PushRow";
import { ShiftReminderSetting } from "@/ui/WorkAlarmSettings";

export default function NotificationSettings() {
  const tr = useT();
  return <Screen back backLabel={tr("Settings")}>
    <Page>
      <PageTitle>{tr("Notifications")}</PageTitle>
      <Card pad={false} style={{ overflow: "hidden" }}>
        <PushRow minimal />
        <ShiftReminderSetting />
      </Card>
    </Page>
  </Screen>;
}
