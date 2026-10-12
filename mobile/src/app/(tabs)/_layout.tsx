import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { BottomTabBar, Tabs } from "expo-router/js-tabs";
import { StyleSheet, View } from "react-native";

import { HandsFreeBadge, HandsFreeProvider } from "@/components/HandsFree";
import { Loading, type IconName } from "@/components/ui";
import { WorkoutMiniBar, WorkoutSessionProvider } from "@/components/WorkoutSession";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

// Five destinations in the bar. Profile is still a tab route (/profile) but opens from the
// avatar button in the Home header, so the bar stays uncluttered.
const TABS: { name: string; title: string; icon: IconName; active: IconName }[] = [
  { name: "home", title: "Today", icon: "today-outline", active: "today" },
  { name: "workouts", title: "Workouts", icon: "barbell-outline", active: "barbell" },
  { name: "food", title: "Food", icon: "restaurant-outline", active: "restaurant" },
  { name: "progress", title: "Progress", icon: "stats-chart-outline", active: "stats-chart" },
  { name: "coach", title: "Coach", icon: "chatbubble-ellipses-outline", active: "chatbubble-ellipses" },
];

export default function TabsLayout() {
  const t = useTheme();
  const { ready, token, profile } = useAuth();
  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;
  if (!profile) return <Redirect href="/onboarding" />;
  return (
    <WorkoutSessionProvider>
      <HandsFreeProvider>
        <Tabs
          // the "workout in progress" bar sits on top of the tab bar, so screens never hide behind it
          tabBar={(props) => (
            <View>
              <WorkoutMiniBar extra={<HandsFreeBadge />} />
              <BottomTabBar {...props} />
            </View>
          )}
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: t.text,
            tabBarInactiveTintColor: t.muted,
            tabBarLabelStyle: { fontSize: 11, fontWeight: "600", letterSpacing: 0.1 },
            tabBarStyle: {
              backgroundColor: t.surface,
              borderTopColor: t.border,
              borderTopWidth: StyleSheet.hairlineWidth,
              elevation: 0,
              shadowOpacity: 0,
            },
            sceneStyle: { backgroundColor: t.bg },
          }}
        >
          {TABS.map((tab) => (
            <Tabs.Screen
              key={tab.name}
              name={tab.name}
              options={{
                title: tab.title,
                tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? tab.active : tab.icon} color={color} size={23} />,
              }}
            />
          ))}
          <Tabs.Screen name="profile" options={{ title: "Profile", href: null }} />
        </Tabs>
      </HandsFreeProvider>
    </WorkoutSessionProvider>
  );
}
