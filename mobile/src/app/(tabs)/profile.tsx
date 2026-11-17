import { router } from "expo-router";
import { useContext } from "react";
import { Switch, Text, View } from "react-native";

import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ProfileForm } from "@/components/ProfileForm";
import { Button, Card, ListRow, Row, Screen, Section, Segmented, Txt, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { AppearanceContext } from "@/lib/appearance";
import { useAuth, useProfile } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { fmt } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { User } from "@/lib/types";

/** Account, settings and the profile behind the plan. Opened from the avatar on the Today screen. */
export default function ProfileTab() {
  const t = useTheme();
  const { t: tr, tn } = useI18n();
  const toast = useToast();
  const { user, setUser, logout } = useAuth();
  const { profile, plan } = useProfile();
  const appearance = useContext(AppearanceContext);
  if (!user) return null;

  const toggleMarketing = async (on: boolean) => {
    setUser(await api<User>("/me/marketing", { method: "PUT", body: { opt_in: on } }));
    toast(tr(on ? "settings.adsOn" : "settings.adsOff"));
  };

  return (
    <Screen title={tr("nav.profile")} back>
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
              {tr("settings.summary", { kcal: fmt(plan.target_calories), days: tn("settings.trainingDays", profile.training_days.length) })}
            </Txt>
          </View>
        </Row>
      </Card>

      <Card style={{ paddingVertical: space.xs }}>
        <ListRow first icon="moon-outline" title={tr("nav.sleep")} subtitle={tr("settings.sleepHint")} onPress={() => router.push("/sleep")} />
        <ListRow icon="sparkles-outline" title={tr("nav.points")} subtitle={tr("settings.pointsHint")} onPress={() => router.push("/points")} />
        <ListRow icon="location-outline" title={tr("nav.gyms")} subtitle={tr("settings.gymsHint")} onPress={() => router.push("/gyms")} />
        <ListRow icon="qr-code-outline" title={tr("nav.qrStickers")} subtitle={tr("settings.qrHint")} onPress={() => router.push("/qr-stickers")} />
      </Card>

      <Section title={tr("settings.details")} />
      <ProfileForm key={JSON.stringify(profile)} profile={profile} onSaved={() => toast(tr("settings.saved"))} />

      <Section title={tr("language.label")} />
      <Card>
        <LanguageSwitch style={{ width: "100%" }} />
        <Txt variant="tiny" style={{ marginTop: space.sm }}>
          {tr("settings.languageHint")}
        </Txt>
      </Card>

      <Section title={tr("settings.appearance")} />
      <Card>
        <Segmented
          options={[
            { value: "system", label: tr("settings.system") },
            { value: "light", label: tr("settings.light") },
            { value: "dark", label: tr("settings.dark") },
          ]}
          value={appearance.preference}
          onChange={appearance.setPreference}
        />
        <Txt variant="tiny" style={{ marginTop: space.sm }}>
          {tr(appearance.preference === "system" ? "settings.followsPhone" : "settings.savedOnDevice")}
        </Txt>
      </Card>

      <Section title={tr("login.email")} />
      <Card>
        <Row style={{ justifyContent: "space-between" }} gap={space.md}>
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: "600" }}>{tr("settings.ads")}</Txt>
            <Txt variant="small">{tr("settings.sendOffers", { email: user.email })}</Txt>
          </View>
          <Switch
            value={user.marketing_opt_in}
            onValueChange={toggleMarketing}
            trackColor={{ true: t.accent, false: t.border }}
            accessibilityLabel={tr("settings.adsLabel")}
          />
        </Row>
      </Card>

      <Section title={tr("settings.account")} />
      <Card>
        <Button title={tr("common.logout")} icon="log-out-outline" kind="soft" onPress={logout} />
        <Button
          title={tr("settings.delete")}
          kind="danger"
          style={{ marginTop: space.sm, borderColor: "transparent" }}
          onPress={async () => {
            if (!(await confirm(tr("settings.deleteTitle"), tr("settings.deleteText"), tr("settings.deleteConfirm")))) return;
            await api("/me", { method: "DELETE" });
            await logout();
          }}
        />
      </Card>
    </Screen>
  );
}
