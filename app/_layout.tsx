import "../global.css";

import { useEffect } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "../constants/colors";
import { AuthProvider, useAuth } from "../lib/AuthProvider";
import { registerBackgroundSync } from "../lib/backgroundSync";

function RootLayoutNav() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inTabsGroup = segments[0] === "(tabs)";

    if (!session && inTabsGroup) {
      router.replace("/sign-in");
    } else if (session && !inTabsGroup) {
      router.replace("/(tabs)");
    }
  }, [session, isLoading, segments, router]);

  useEffect(() => {
    // Background Fetch / lokale Notifications sind auf Web nicht sinnvoll
    // nutzbar und nur in Dev-/EAS-Builds wirklich zuverlaessig (nicht in
    // Expo Go) - siehe lib/backgroundSync.ts.
    if (session && Platform.OS !== "web") {
      registerBackgroundSync();
    }
  }, [session]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-900">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <RootLayoutNav />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
