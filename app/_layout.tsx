import "../global.css";

import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "../constants/colors";
import { AuthProvider, useAuth } from "../lib/AuthProvider";
import { registerBackgroundSync } from "../lib/backgroundSync";
import { supabase } from "../supabase/client";

function RootLayoutNav() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // null = noch nicht geladen (nicht redirecten, bis wir es wissen)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) {
      setHasCompletedOnboarding(null);
      return;
    }
    supabase
      .from("user_settings")
      .select("has_completed_onboarding")
      .maybeSingle()
      .then(({ data }) => setHasCompletedOnboarding(Boolean(data?.has_completed_onboarding)));
  }, [session]);

  useEffect(() => {
    if (isLoading) return;

    const inTabsGroup = segments[0] === "(tabs)";
    const inOnboarding = segments[0] === "onboarding";

    if (!session) {
      if (inTabsGroup || inOnboarding) router.replace("/sign-in");
      return;
    }

    if (hasCompletedOnboarding === null) return; // Onboarding-Status wird noch geladen

    if (!hasCompletedOnboarding) {
      if (!inOnboarding) router.replace("/onboarding");
    } else if (!inTabsGroup) {
      router.replace("/(tabs)");
    }
  }, [session, isLoading, hasCompletedOnboarding, segments, router]);

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
      <Stack.Screen name="onboarding" />
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
