import React from "react";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { siteUrl } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { useT } from "@/i18n";
import { Page, PageTitle, Screen } from "@/ui";
import { ProfileGroup } from "@/ui/ProfileGroup";
import { ProfileRow } from "@/ui/ProfileRow";
import { notify } from "@/ui/confirm";

export default function Help() {
  const tr = useT(), router = useRouter();
  const open = (path: string) => {
    void openBrowserAsync(siteUrl(path)).catch(error => notify(tr("Couldn't open that page"), errorMessage(error)));
  };
  return <Screen back backLabel={tr("Settings")}>
    <Page>
      <PageTitle>{tr("Help")}</PageTitle>
      <ProfileGroup>
        <ProfileRow icon="cloud-offline-outline" title={tr("Offline shifts")} onPress={() => router.push("/profile/offline")} />
        <ProfileRow icon="help-circle-outline" title={tr("Report a problem")} onPress={() => router.push("/profile/report")} />
        <ProfileRow icon="people-outline" title={tr("Community rules")} onPress={() => open("/safety/rules/")} />
        <ProfileRow icon="document-text-outline" title={tr("Privacy")} onPress={() => open("/privacy/")} />
      </ProfileGroup>
    </Page>
  </Screen>;
}
