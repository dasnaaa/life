import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Tabs } from "expo-router";

import { colors } from "../../constants/colors";
import { useUnreadBadge } from "../../lib/useUnreadBadge";
import { useUnreadNotifications } from "../../lib/useUnreadNotifications";

function NotificationBell() {
  const unreadNotifications = useUnreadNotifications();

  return (
    <Pressable onPress={() => router.push("/notifications")} className="mr-1 p-2 active:opacity-70">
      <View>
        <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
        {unreadNotifications > 0 ? (
          <View className="absolute -right-1 -top-1 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1">
            <Text className="text-[10px] font-bold text-white">{unreadNotifications > 9 ? "9+" : unreadNotifications}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function TabsLayout() {
  const unreadCount = useUnreadBadge();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerRight: () => <NotificationBell />,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarBadgeStyle: { backgroundColor: colors.danger },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Brief",
          tabBarIcon: ({ color, size }) => <Ionicons name="sunny-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Nachrichten",
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: "Kontakte",
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Kalender",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: "Arbeit",
          tabBarIcon: ({ color, size }) => <Ionicons name="briefcase-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Einstellungen",
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
