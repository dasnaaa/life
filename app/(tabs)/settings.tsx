import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SectionHeader } from "../../components/SectionHeader";
import { connectClickUpAccount, connectOAuthAccount } from "../../lib/connectAccount";
import { fetchWhatsAppStatus, getWhatsAppServiceConfig, setWhatsAppServiceConfig, type WhatsAppStatus } from "../../lib/whatsappService";
import { supabase } from "../../supabase/client";

type ConnectedAccount = {
  id: string;
  provider: string;
  account_label: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  credentials: { provider_email?: string | null } | null;
};

type SectionsEnabled = { email: boolean; news: boolean; messages: boolean; calendar: boolean };

function formatTimestamp(value: string | null): string {
  if (!value) return "noch nie";
  return new Date(value).toLocaleString("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function SettingsScreen() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [newGoogleLabel, setNewGoogleLabel] = useState("");
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [newSlackLabel, setNewSlackLabel] = useState("");
  const [isConnectingSlack, setIsConnectingSlack] = useState(false);
  const [newClickupLabel, setNewClickupLabel] = useState("");
  const [newClickupToken, setNewClickupToken] = useState("");
  const [isConnectingClickup, setIsConnectingClickup] = useState(false);

  const [whatsappUrl, setWhatsappUrl] = useState("");
  const [whatsappKey, setWhatsappKey] = useState("");
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppStatus | null>(null);
  const [isCheckingWhatsapp, setIsCheckingWhatsapp] = useState(false);

  const [newContactName, setNewContactName] = useState("");
  const [newContactIdentifier, setNewContactIdentifier] = useState("");
  const [newContactBirthday, setNewContactBirthday] = useState("");
  const [newContactFrequency, setNewContactFrequency] = useState("");
  const [newContactIsPriority, setNewContactIsPriority] = useState(false);
  const [newContactIsFamily, setNewContactIsFamily] = useState(false);
  const [isAddingContact, setIsAddingContact] = useState(false);

  const [briefTime, setBriefTime] = useState("06:30");
  const [sectionsEnabled, setSectionsEnabled] = useState<SectionsEnabled>({
    email: true,
    news: true,
    messages: true,
    calendar: true,
  });
  const [newsSources, setNewsSources] = useState("derstandard.at,orf.at,diepresse.com,apa.at");
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const loadAccounts = useCallback(async () => {
    setIsLoadingAccounts(true);
    const { data, error } = await supabase
      .from("connected_accounts")
      .select("id, provider, account_label, is_active, last_synced_at, credentials")
      .order("created_at", { ascending: true });

    if (error) {
      setFeedback({ type: "error", text: `Accounts konnten nicht geladen werden: ${error.message}` });
    } else {
      setAccounts((data ?? []) as ConnectedAccount[]);
    }
    setIsLoadingAccounts(false);
  }, []);

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from("user_settings").select("*").maybeSingle();
    if (data) {
      setBriefTime((data.brief_time as string).slice(0, 5));
      setSectionsEnabled({ email: true, news: true, messages: true, calendar: true, ...(data.sections_enabled ?? {}) });
      setNewsSources((data.news_sources ?? []).join(","));
    }
  }, []);

  useEffect(() => {
    loadAccounts();
    loadSettings();
    getWhatsAppServiceConfig().then(({ url, apiKey }) => {
      if (url) setWhatsappUrl(url);
      if (apiKey) setWhatsappKey(apiKey);
    });
  }, [loadAccounts, loadSettings]);

  async function handleSync(accountId: string, syncFunctionName: string) {
    setSyncingAccountId(accountId);
    setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke(syncFunctionName, { body: { account_id: accountId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setFeedback({ type: "success", text: "Sync abgeschlossen." });
    } catch (error) {
      setFeedback({ type: "error", text: `Sync fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setSyncingAccountId(null);
      loadAccounts();
    }
  }

  async function handleConnectOAuth(
    provider: "google" | "slack",
    label: string,
    setLabel: (v: string) => void,
    setBusy: (v: boolean) => void
  ) {
    if (!label.trim()) {
      setFeedback({ type: "error", text: 'Bitte zuerst ein Label eingeben (z.B. "Privat").' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await connectOAuthAccount(`${provider}-oauth-start`, label.trim());
      setLabel("");
      await loadAccounts();

      const { data: fresh } = await supabase
        .from("connected_accounts")
        .select("id")
        .eq("provider", provider)
        .is("last_synced_at", null);
      for (const account of fresh ?? []) {
        await handleSync(account.id, provider === "google" ? "sync-google" : "sync-slack");
      }
    } catch (error) {
      setFeedback({ type: "error", text: `Verbinden fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectClickUp() {
    if (!newClickupLabel.trim() || !newClickupToken.trim()) {
      setFeedback({ type: "error", text: "Bitte Label und API-Token eingeben." });
      return;
    }
    setIsConnectingClickup(true);
    setFeedback(null);
    try {
      await connectClickUpAccount(newClickupLabel.trim(), newClickupToken.trim());
      setNewClickupLabel("");
      setNewClickupToken("");
      await loadAccounts();
      setFeedback({ type: "success", text: "ClickUp verbunden." });
    } catch (error) {
      setFeedback({ type: "error", text: `Verbinden fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setIsConnectingClickup(false);
    }
  }

  async function handleToggleActive(account: ConnectedAccount) {
    const { error } = await supabase.from("connected_accounts").update({ is_active: !account.is_active }).eq("id", account.id);
    if (error) {
      setFeedback({ type: "error", text: `Konnte Status nicht aendern: ${error.message}` });
      return;
    }
    loadAccounts();
  }

  async function handleCheckWhatsapp() {
    if (!whatsappUrl.trim() || !whatsappKey.trim()) {
      setFeedback({ type: "error", text: "Bitte Service-URL und API-Key eingeben." });
      return;
    }
    setIsCheckingWhatsapp(true);
    setFeedback(null);
    try {
      await setWhatsAppServiceConfig(whatsappUrl.trim(), whatsappKey.trim());
      const status = await fetchWhatsAppStatus(whatsappUrl.trim(), whatsappKey.trim());
      setWhatsappStatus(status);
    } catch (error) {
      setFeedback({
        type: "error",
        text: `WhatsApp-Service nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`,
      });
      setWhatsappStatus(null);
    } finally {
      setIsCheckingWhatsapp(false);
    }
  }

  async function handleAddContact() {
    if (!newContactName.trim()) {
      setFeedback({ type: "error", text: "Bitte einen Namen eingeben." });
      return;
    }
    setIsAddingContact(true);
    setFeedback(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("contact_tracking").insert({
        user_id: userData.user?.id,
        contact_name: newContactName.trim(),
        contact_identifier: newContactIdentifier.trim() || null,
        birthday: newContactBirthday.trim() || null,
        contact_frequency_days: newContactFrequency ? Number(newContactFrequency) : null,
        is_priority: newContactIsPriority,
        is_family: newContactIsFamily,
      });
      if (error) throw error;

      setNewContactName("");
      setNewContactIdentifier("");
      setNewContactBirthday("");
      setNewContactFrequency("");
      setNewContactIsPriority(false);
      setNewContactIsFamily(false);
      setFeedback({ type: "success", text: "Kontakt hinzugefügt." });
    } catch (error) {
      setFeedback({ type: "error", text: `Kontakt konnte nicht angelegt werden: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setIsAddingContact(false);
    }
  }

  async function handleSaveBriefSettings() {
    setIsSavingSettings(true);
    setFeedback(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("user_settings").upsert(
        {
          user_id: userData.user?.id,
          brief_time: `${briefTime}:00`,
          sections_enabled: sectionsEnabled,
          news_sources: newsSources.split(",").map((s) => s.trim()).filter(Boolean),
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;
      setFeedback({ type: "success", text: "Brief-Einstellungen gespeichert." });
    } catch (error) {
      setFeedback({ type: "error", text: `Speichern fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  const googleAccounts = accounts.filter((a) => a.provider === "google");
  const slackAccounts = accounts.filter((a) => a.provider === "slack");
  const clickupAccounts = accounts.filter((a) => a.provider === "clickup");
  const whatsappAccount = accounts.find((a) => a.provider === "whatsapp") ?? null;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <SectionHeader title="Account-Verbindungen" />

        {feedback ? (
          <View className="mx-4 mb-3 rounded-xl border border-slate-700 bg-slate-800 p-3">
            <Text className={feedback.type === "error" ? "text-sm text-rose-400" : "text-sm text-emerald-400"}>
              {feedback.text}
            </Text>
          </View>
        ) : null}

        {/* Google */}
        <ProviderSection
          title="Google-Accounts"
          isLoading={isLoadingAccounts}
          accounts={googleAccounts}
          syncingAccountId={syncingAccountId}
          onSync={(id) => handleSync(id, "sync-google")}
          onToggle={handleToggleActive}
        />
        <ConnectForm
          label={newGoogleLabel}
          onChangeLabel={setNewGoogleLabel}
          placeholder='Label, z.B. "Privat" oder "Arbeit SPÖ"'
          buttonText="Google Account hinzufügen"
          isBusy={isConnectingGoogle}
          onSubmit={() => handleConnectOAuth("google", newGoogleLabel, setNewGoogleLabel, setIsConnectingGoogle)}
        />

        {/* Slack */}
        <ProviderSection
          title="Slack-Accounts"
          isLoading={isLoadingAccounts}
          accounts={slackAccounts}
          syncingAccountId={syncingAccountId}
          onSync={(id) => handleSync(id, "sync-slack")}
          onToggle={handleToggleActive}
        />
        <ConnectForm
          label={newSlackLabel}
          onChangeLabel={setNewSlackLabel}
          placeholder='Label, z.B. "Arbeit"'
          buttonText="Slack verbinden"
          isBusy={isConnectingSlack}
          onSubmit={() => handleConnectOAuth("slack", newSlackLabel, setNewSlackLabel, setIsConnectingSlack)}
        />

        {/* ClickUp */}
        <ProviderSection
          title="ClickUp-Accounts"
          isLoading={isLoadingAccounts}
          accounts={clickupAccounts}
          syncingAccountId={syncingAccountId}
          onSync={(id) => handleSync(id, "sync-clickup")}
          onToggle={handleToggleActive}
        />
        <View className="mx-4 mb-4 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <Text className="mb-2 text-sm font-medium text-slate-300">ClickUp verbinden</Text>
          <TextInput
            value={newClickupLabel}
            onChangeText={setNewClickupLabel}
            placeholder="Label"
            placeholderTextColor="#64748B"
            className="mb-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />
          <TextInput
            value={newClickupToken}
            onChangeText={setNewClickupToken}
            placeholder="Persönlicher API-Token"
            placeholderTextColor="#64748B"
            secureTextEntry
            autoCapitalize="none"
            className="mb-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />
          <Pressable
            onPress={handleConnectClickUp}
            disabled={isConnectingClickup}
            className="items-center rounded-lg bg-sky-500 py-2.5 active:opacity-80 disabled:opacity-50"
          >
            {isConnectingClickup ? <ActivityIndicator color="#0F172A" /> : <Text className="font-semibold text-slate-900">Verbinden</Text>}
          </Pressable>
        </View>

        {/* WhatsApp */}
        <View className="mx-4 mb-4 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <Text className="mb-2 text-sm font-medium text-slate-300">WhatsApp-Service</Text>
          <Text className="mb-2 text-xs text-slate-500">
            Läuft lokal auf deinem Mac oder VPS (siehe whatsapp-service/). Trag hier die Adresse ein, unter der du ihn
            von diesem Gerät aus erreichst.
          </Text>
          {whatsappAccount ? (
            <Text className="mb-2 text-xs text-slate-400">
              Verbundenes Konto: {whatsappAccount.account_label} · Letzter Sync: {formatTimestamp(whatsappAccount.last_synced_at)}
            </Text>
          ) : null}
          <TextInput
            value={whatsappUrl}
            onChangeText={setWhatsappUrl}
            placeholder="http://localhost:3001"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            className="mb-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />
          <TextInput
            value={whatsappKey}
            onChangeText={setWhatsappKey}
            placeholder="WHATSAPP_SERVICE_API_KEY"
            placeholderTextColor="#64748B"
            secureTextEntry
            autoCapitalize="none"
            className="mb-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />
          <Pressable
            onPress={handleCheckWhatsapp}
            disabled={isCheckingWhatsapp}
            className="items-center rounded-lg border border-slate-600 py-2.5 active:opacity-70 disabled:opacity-50"
          >
            {isCheckingWhatsapp ? <ActivityIndicator color="#38BDF8" /> : <Text className="text-sm text-slate-200">Status prüfen</Text>}
          </Pressable>

          {whatsappStatus ? (
            <View className="mt-3">
              <Text className="text-sm text-slate-300">
                Status: {whatsappStatus.connected ? "Verbunden ✓" : whatsappStatus.status}
                {whatsappStatus.phoneNumber ? ` (${whatsappStatus.phoneNumber})` : ""}
              </Text>
              {whatsappStatus.status === "qr" && whatsappStatus.qr ? (
                <View className="mt-2 items-center">
                  <Text className="mb-2 text-xs text-slate-400">QR-Code in WhatsApp scannen:</Text>
                  <Image source={{ uri: whatsappStatus.qr }} style={{ width: 220, height: 220 }} />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Kontakt-Konfiguration */}
        <SectionHeader title="Kontakt-Konfiguration" subtitle="Manuell Kontakte hinzufügen" />
        <View className="mx-4 mb-4 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <TextInput
            value={newContactName}
            onChangeText={setNewContactName}
            placeholder="Name"
            placeholderTextColor="#64748B"
            className="mb-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />
          <TextInput
            value={newContactIdentifier}
            onChangeText={setNewContactIdentifier}
            placeholder="E-Mail / Telefonnummer (optional)"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            className="mb-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />
          <TextInput
            value={newContactBirthday}
            onChangeText={setNewContactBirthday}
            placeholder="Geburtstag (JJJJ-MM-TT, Jahr optional -> 1900)"
            placeholderTextColor="#64748B"
            className="mb-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />
          <TextInput
            value={newContactFrequency}
            onChangeText={setNewContactFrequency}
            placeholder="Kontakt-Frequenz in Tagen (z.B. 3 für Familie)"
            placeholderTextColor="#64748B"
            keyboardType="number-pad"
            className="mb-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-sm text-slate-300">Prioritätskontakt</Text>
            <Switch value={newContactIsPriority} onValueChange={setNewContactIsPriority} />
          </View>
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-sm text-slate-300">Familie</Text>
            <Switch value={newContactIsFamily} onValueChange={setNewContactIsFamily} />
          </View>
          <Pressable
            onPress={handleAddContact}
            disabled={isAddingContact}
            className="items-center rounded-lg bg-sky-500 py-2.5 active:opacity-80 disabled:opacity-50"
          >
            {isAddingContact ? <ActivityIndicator color="#0F172A" /> : <Text className="font-semibold text-slate-900">Kontakt hinzufügen</Text>}
          </Pressable>
        </View>

        {/* Brief-Einstellungen */}
        <SectionHeader title="Brief-Einstellungen" />
        <View className="mx-4 mb-4 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <Text className="mb-1 text-sm text-slate-300">Brief-Uhrzeit (Wiener Zeit)</Text>
          <TextInput
            value={briefTime}
            onChangeText={setBriefTime}
            placeholder="06:30"
            placeholderTextColor="#64748B"
            className="mb-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />

          {(Object.keys(sectionsEnabled) as (keyof SectionsEnabled)[]).map((key) => (
            <View key={key} className="mb-2 flex-row items-center justify-between">
              <Text className="text-sm capitalize text-slate-300">{key}</Text>
              <Switch
                value={sectionsEnabled[key]}
                onValueChange={(value) => setSectionsEnabled((prev) => ({ ...prev, [key]: value }))}
              />
            </View>
          ))}

          <Text className="mb-1 mt-2 text-sm text-slate-300">News-Quellen (Domains, mit Komma getrennt)</Text>
          <TextInput
            value={newsSources}
            onChangeText={setNewsSources}
            placeholder="derstandard.at,orf.at,diepresse.com,apa.at"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            className="mb-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />

          <Pressable
            onPress={handleSaveBriefSettings}
            disabled={isSavingSettings}
            className="items-center rounded-lg bg-sky-500 py-2.5 active:opacity-80 disabled:opacity-50"
          >
            {isSavingSettings ? <ActivityIndicator color="#0F172A" /> : <Text className="font-semibold text-slate-900">Speichern</Text>}
          </Pressable>
        </View>

        <Pressable onPress={handleSignOut} className="mx-4 mt-4 items-center rounded-xl border border-rose-900 py-3">
          <Text className="text-sm font-medium text-rose-400">Abmelden</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProviderSection({
  title,
  isLoading,
  accounts,
  syncingAccountId,
  onSync,
  onToggle,
}: {
  title: string;
  isLoading: boolean;
  accounts: ConnectedAccount[];
  syncingAccountId: string | null;
  onSync: (id: string) => void;
  onToggle: (account: ConnectedAccount) => void;
}) {
  return (
    <View className="mx-4 mb-2">
      <Text className="mb-2 text-sm font-medium text-slate-300">{title}</Text>
      {isLoading ? (
        <ActivityIndicator color="#38BDF8" />
      ) : accounts.length === 0 ? (
        <Text className="text-sm text-slate-500">Noch nicht verbunden.</Text>
      ) : (
        <View className="gap-2">
          {accounts.map((account) => (
            <View key={account.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="font-medium text-slate-50">{account.account_label ?? account.provider}</Text>
                  {account.credentials?.provider_email ? (
                    <Text className="text-xs text-slate-400">{account.credentials.provider_email}</Text>
                  ) : null}
                  <Text className="mt-1 text-xs text-slate-500">Letzter Sync: {formatTimestamp(account.last_synced_at)}</Text>
                </View>
                <Switch value={account.is_active} onValueChange={() => onToggle(account)} />
              </View>
              <Pressable
                onPress={() => onSync(account.id)}
                disabled={syncingAccountId === account.id || !account.is_active}
                className="mt-3 items-center rounded-lg border border-slate-600 py-2 active:opacity-70 disabled:opacity-40"
              >
                {syncingAccountId === account.id ? (
                  <ActivityIndicator color="#38BDF8" />
                ) : (
                  <Text className="text-sm text-slate-200">Jetzt syncen</Text>
                )}
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ConnectForm({
  label,
  onChangeLabel,
  placeholder,
  buttonText,
  isBusy,
  onSubmit,
}: {
  label: string;
  onChangeLabel: (v: string) => void;
  placeholder: string;
  buttonText: string;
  isBusy: boolean;
  onSubmit: () => void;
}) {
  return (
    <View className="mx-4 mb-4 rounded-xl border border-slate-700 bg-slate-800 p-3">
      <TextInput
        value={label}
        onChangeText={onChangeLabel}
        placeholder={placeholder}
        placeholderTextColor="#64748B"
        className="mb-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
      />
      <Pressable onPress={onSubmit} disabled={isBusy} className="items-center rounded-lg bg-sky-500 py-2.5 active:opacity-80 disabled:opacity-50">
        {isBusy ? <ActivityIndicator color="#0F172A" /> : <Text className="font-semibold text-slate-900">{buttonText}</Text>}
      </Pressable>
    </View>
  );
}
