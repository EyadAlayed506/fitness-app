import { router } from "expo-router";
import { useContext } from "react";
import { Switch, Text, View } from "react-native";

import { ProfileForm } from "@/components/ProfileForm";
import { Button, Card, ListRow, Row, Screen, Section, Segmented, Txt, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { AppearanceContext } from "@/lib/appearance";
import { useAuth, useProfile } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { User } from "@/lib/types";

/** Account, settings and the profile behind the plan. Opened from the avatar on the Today screen. */
export default function ProfileTab() {
  const t = useTheme();
  const toast = useToast();
  const { user, setUser, logout } = useAuth();
  const { profile, plan } = useProfile();
  const appearance = useContext(AppearanceContext);
  if (!user) return null;

  const toggleMarketing = async (on: boolean) => {
    setUser(await api<User>("/me/marketing", { method: "PUT", body: { opt_in: on } }));
    toast(on ? "You'll get ads and discounts by email" : "Unsubscribed from ads and discounts");
  };

  return (
    <Screen title="Profile" back>
      <Card>
        <Row gap={space.md}>
          <View style={{ width: 52, height: 52, borderRadius: radius.pill, backgroundColor: t.ink, alignItems: "center", justifyContent: "center" }}>
            <Text style={[typeScale.title, { color: t.inkText, fontSize: 22 }]}>{user.email.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={{ fontWeight: "600" }} numberOfLines={1}>
              {user.email}
            </Txt>
            <Txt variant="small">
              {plan.target_calories.toLocaleString(undefined, { maximumFractionDigits: 0 })} kcal a day · {profile.training_days.length} training days
            </Txt>
          </View>
        </Row>
      </Card>

      <Card style={{ paddingVertical: space.xs }}>
        <ListRow first icon="moon-outline" title="Sleep" subtitle="Log nights, goal, WHOOP" onPress={() => router.push("/sleep")} />
        <ListRow icon="sparkles-outline" title="Wellness points" subtitle="Level, history and achievements" onPress={() => router.push("/points")} />
        <ListRow icon="location-outline" title="Gyms" subtitle="Machine photos, settings, photograph a gym" onPress={() => router.push("/gyms")} />
        <ListRow icon="qr-code-outline" title="QR stickers" subtitle="Print codes for the gym machines" onPress={() => router.push("/qr-stickers")} />
      </Card>

      <Section title="Your details" />
      <ProfileForm key={JSON.stringify(profile)} profile={profile} onSaved={() => toast("Profile saved")} />

      <Section title="Appearance" />
      <Card>
        <Segmented
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          value={appearance.preference}
          onChange={appearance.setPreference}
        />
        <Txt variant="tiny" style={{ marginTop: space.sm }}>
          {appearance.preference === "system" ? "Follows your phone's light or dark mode." : "Saved on this device."}
        </Txt>
      </Card>

      <Section title="Email" />
      <Card>
        <Row style={{ justifyContent: "space-between" }} gap={space.md}>
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: "600" }}>Ads and discounts</Txt>
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

      <Section title="Account" />
      <Card>
        <Button title="Log out" icon="log-out-outline" kind="soft" onPress={logout} />
        <Button
          title="Delete my account and data"
          kind="danger"
          style={{ marginTop: space.sm, borderColor: "transparent" }}
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
