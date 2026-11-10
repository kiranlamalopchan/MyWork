import React from "react";
import { useRouter } from "expo-router";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n";
import { Card, Page, PageTitle, Screen } from "@/ui";
import { BiometricRow } from "@/ui/BiometricRow";
import { ProfileGroup } from "@/ui/ProfileGroup";
import { ProfileRow } from "@/ui/ProfileRow";
import { SocialSignIn } from "@/ui/SocialSignIn";

export default function PrivacySettings() {
  const { me } = useSession();
  const tr = useT(), router = useRouter();
  if (!me) return null;
  return <Screen back backLabel={tr("Settings")}>
    <Page>
      <PageTitle>{tr("Privacy & security")}</PageTitle>
      <ProfileGroup>
        {me.has_password !== false ? <ProfileRow icon="key-outline" title={tr("Change password")} onPress={() => router.push("/profile/password")} testID="change-password" /> : null}
        <ProfileRow icon="ban-outline" title={tr("Blocked people")} onPress={() => router.push("/profile/blocked")} testID="blocked-people" />
      </ProfileGroup>
      <BiometricRow username={me.username} />
      <SocialSignIn purpose="link" />
      <Card pad={false} style={{ overflow: "hidden" }}>
        <ProfileRow icon="trash-outline" title={tr("Delete account")} danger onPress={() => router.push("/profile/delete")} testID="delete-account" />
      </Card>
    </Page>
  </Screen>;
}
