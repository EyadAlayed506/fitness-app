import { Redirect } from "expo-router";

import { Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/** Sends the user to the right place: login, profile setup, or the app. */
export default function Index() {
  const { ready, token, profile } = useAuth();
  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;
  if (!profile) return <Redirect href="/onboarding" />;
  return <Redirect href="/home" />;
}
