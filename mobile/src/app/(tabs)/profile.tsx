import { Switch, View } from "react-native";

import { ProfileForm } from "@/components/ProfileForm";
import { Button, Card, Row, Screen, Section, Txt, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, useProfile } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { useTheme } from "@/lib/theme";
import type { User } from "@/lib/types";

export default function ProfileTab() {
  const t = useTheme();
  const toast = useToast();
  const { user, setUser, logout } = useAuth();
  const { profile } = useProfile();
  if (!user) return null;

  const toggleMarketing = async (on: boolean) => {
    setUser(await api<User>("/me/marketing", { method: "PUT", body: { opt_in: on } }));
    toast(on ? "You'll get ads and discounts by email" : "Unsubscribed from ads and discounts");
  };

  return (
    <Screen title="Profile" subtitle={user.email}>
      <Card>
        <Row style={{ justifyContent: "space-between" }} gap={12}>
          <View style={{ flex: 1 }}>
            <Txt variant="h3">Ads and discounts</Txt>
            <Txt variant="small">Send offers to {user.email}</Txt>
          </View>
          <Switch
            value={user.marketing_opt_in}
            onValueChange={toggleMarketing}
            trackColor={{ true: t.accent, false: t.border }}
            accessibilityLabel="Email me ads and discounts"
          />
        </Row>
      </Card>
      <ProfileForm key={JSON.stringify(profile)} profile={profile} onSaved={() => toast("Profile saved")} />
      <Section title="Account" />
      <Card>
        <Button title="Log out" kind="ghost" onPress={logout} />
        <Button
          title="Delete my account and data"
          kind="danger"
          style={{ marginTop: 10 }}
          onPress={async () => {
            if (!(await confirm("Delete account?", "This deletes your account and all your data. It cannot be undone.", "Delete"))) return;
            await api("/me", { method: "DELETE" });
            await logout();
          }}
        />
      </Card>
    </Screen>
  );
}
