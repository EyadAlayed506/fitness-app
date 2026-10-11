import { Redirect, router } from "expo-router";

import { ProfileForm } from "@/components/ProfileForm";
import { Button, Screen } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Onboarding() {
  const { token, logout } = useAuth();
  if (!token) return <Redirect href="/login" />;
  return (
    <Screen
      title="Set up your profile"
      subtitle="This gives you your BMI, calories and workout plan"
      right={<Button title="Log out" kind="ghost" small onPress={logout} />}
    >
      <ProfileForm profile={null} onSaved={() => router.replace("/home")} />
    </Screen>
  );
}
