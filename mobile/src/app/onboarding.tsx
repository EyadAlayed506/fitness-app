import { Redirect, router } from "expo-router";

import { ProfileForm } from "@/components/ProfileForm";
import { Button, Screen, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Onboarding() {
  const { token, logout } = useAuth();
  if (!token) return <Redirect href="/login" />;
  return (
    <Screen
      title="Set up your profile"
      subtitle="WELCOME"
      right={<Button title="Log out" kind="ghost" small onPress={logout} />}
    >
      <Txt variant="small" style={{ marginTop: -8, marginBottom: 16 }}>
        A few details give you your BMI, daily calories and a workout plan. You can change them any time.
      </Txt>
      <ProfileForm profile={null} onSaved={() => router.replace("/home")} />
    </Screen>
  );
}
