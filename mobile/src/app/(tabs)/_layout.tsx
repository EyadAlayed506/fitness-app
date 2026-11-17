import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { BottomTabBar, Tabs } from "expo-router/js-tabs";
import { StyleSheet, View } from "react-native";

import { HandsFreeBadge, HandsFreeProvider } from "@/components/HandsFree";
import { Loading, type IconName } from "@/components/ui";
import { WorkoutMiniBar, WorkoutSessionProvider } from "@/components/WorkoutSession";
import { useAuth } from "@/lib/auth";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Five destinations in the bar. Profile is still a tab route (/profile) but opens from the
// avatar button in the Home header, so the bar stays uncluttered.
const TABS: { name: string; title: MessageKey; icon: IconName; active: IconName }[] = [
  { name: "home", title: "nav.today", icon: "today-outline", active: "today" },
  { name: "workouts", title: "nav.workouts", icon: "barbell-outline", active: "barbell" },
  { name: "food", title: "nav.food", icon: "restaurant-outline", active: "restaurant" },
  { name: "progress", title: "nav.progress", icon: "stats-chart-outline", active: "stats-chart" },
  { name: "coach", title: "nav.coach", icon: "chatbubble-ellipses-outline", active: "chatbubble-ellipses" },
];

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
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
            // flexShrink 0: on the web the label was squeezed to 10px and cut off. No letter spacing in Arabic (joined letters).
            tabBarLabelStyle: { fontSize: 11, fontWeight: "600", lineHeight: 15, flexShrink: 0, letterSpacing: lang === "ar" ? 0 : 0.1 },
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
                title: tr(tab.title),
                tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? tab.active : tab.icon} color={color} size={23} />,
              }}
            />
          ))}
          <Tabs.Screen name="profile" options={{ title: tr("nav.profile"), href: null }} />
        </Tabs>
      </HandsFreeProvider>
    </WorkoutSessionProvider>
  );
}
