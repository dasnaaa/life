import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { supabase } from "../supabase/client";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  async function handleSubmit() {
    if (!email || !password) {
      setErrorMessage("Bitte E-Mail und Passwort eingeben.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setIsSubmitting(false);

    if (result.error) {
      setErrorMessage(result.error.message);
      return;
    }

    if (mode === "sign-up" && !result.data.session) {
      setInfoMessage("Konto erstellt. Falls E-Mail-Bestaetigung aktiviert ist, bitte Posteingang pruefen.");
      return;
    }

    router.replace("/(tabs)");
  }

  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-slate-900 px-6">
      <Text className="mb-1 text-2xl font-bold text-slate-50">Daily Brief</Text>
      <Text className="mb-8 text-sm text-slate-400">
        {mode === "sign-in" ? "Melde dich an" : "Erstelle dein Konto"}
      </Text>

      <View className="w-full max-w-sm gap-3">
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="E-Mail"
          placeholderTextColor="#64748B"
          autoCapitalize="none"
          keyboardType="email-address"
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-slate-50"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Passwort"
          placeholderTextColor="#64748B"
          secureTextEntry
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-slate-50"
        />

        {errorMessage ? <Text className="text-sm text-rose-400">{errorMessage}</Text> : null}
        {infoMessage ? <Text className="text-sm text-emerald-400">{infoMessage}</Text> : null}

        <Pressable
          onPress={handleSubmit}
          disabled={isSubmitting}
          className="mt-2 items-center rounded-xl bg-sky-500 py-3 active:opacity-80 disabled:opacity-50"
        >
          {isSubmitting ? (
            <ActivityIndicator color="#0F172A" />
          ) : (
            <Text className="font-semibold text-slate-900">
              {mode === "sign-in" ? "Anmelden" : "Konto erstellen"}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          className="mt-1 items-center py-2"
        >
          <Text className="text-sm text-slate-400">
            {mode === "sign-in" ? "Noch kein Konto? Registrieren" : "Schon ein Konto? Anmelden"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
