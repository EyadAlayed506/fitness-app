import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";

import { Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "home", title: "Home", icon: "home-outline" },
  { name: "workouts", title: "Workouts", icon: "barbell-outline" },
  { name: "food", title: "Food", icon: "restaurant-outline" },
  { name: "progress", title: "Progress", icon: "stats-chart-outline" },
  { name: "coach", title: "Coach", icon: "chatbubbles-outline" },
  { name: "profile", title: "Profile", icon: "person-outline" },
];

export default function TabsLayout() {
  const t = useTheme();
  const { ready, token, profile } = useAuth();
  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;
  if (!profile) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
