import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DialogProvider, ToastProvider } from "@/components/ui";
import { AppearanceProvider } from "@/lib/appearance";
import { AuthProvider } from "@/lib/auth";
import { queryClient } from "@/lib/query";
import { useTheme } from "@/lib/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppearanceProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </QueryClientProvider>
      </AppearanceProvider>
    </SafeAreaProvider>
  );
}

/** Everything that depends on light/dark mode (it's chosen by AppearanceProvider above). */
function AppShell() {
  const t = useTheme();
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: t.bg, card: t.surface, text: t.text, border: t.border, primary: t.accent },
  };
  return (
    <ThemeProvider value={navTheme}>
      <ToastProvider>
        <DialogProvider>
          <StatusBar style={t.dark ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: t.bg },
              headerStyle: { backgroundColor: t.bg },
              headerShadowVisible: false,
              headerTitleStyle: { fontSize: 17, fontWeight: "600", color: t.text },
              headerTintColor: t.text,
              headerBackButtonDisplayMode: "minimal",
            }}
          >
            <Stack.Screen name="qr-stickers" options={{ headerShown: true, title: "QR stickers" }} />
            <Stack.Screen name="sleep" options={{ headerShown: true, title: "Sleep" }} />
            <Stack.Screen name="points" options={{ headerShown: true, title: "Wellness points" }} />
            <Stack.Screen name="gyms" options={{ headerShown: true, title: "Gyms" }} />
          </Stack>
        </DialogProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
