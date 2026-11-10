import React from "react";
import { useRouter } from "expo-router";
import { useSession } from "@/auth/session";
import { Page, PageTitle, Screen } from "@/ui";
import { ProfileRow } from "@/ui/ProfileRow";
import { ProfileGroup } from "@/ui/ProfileGroup";
import { useT } from "@/i18n";

export default function ProfileSettings() {
  const { me } = useSession();
  const router = useRouter(), tr = useT();
  if (!me) return null;
  return <Screen back backLabel={tr("Profile")} section={tr("Settings")}>
    <Page>
      <PageTitle>{tr("Settings")}</PageTitle>
      <ProfileGroup>
        <ProfileRow icon="contrast-outline" title={tr("Appearance")} onPress={() => router.push("/profile/appearance")} />
        <ProfileRow icon="notifications-outline" title={tr("Notifications")} onPress={() => router.push("/profile/notifications")} />
        <ProfileRow icon="shield-checkmark-outline" title={tr("Privacy & security")} onPress={() => router.push("/profile/privacy")} />
        <ProfileRow icon="help-circle-outline" title={tr("Help")} onPress={() => router.push("/profile/help")} />
        {me.can_manage_festival ? <ProfileRow icon="sparkles-outline" title={tr("Festival banner")} onPress={() => router.push("/profile/festival")} testID="manage-festival-banner" /> : null}
      </ProfileGroup>
    </Page>
  </Screen>;
}
