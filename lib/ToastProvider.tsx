import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../constants/colors";

type ToastType = "success" | "error" | "info";
type Toast = { id: number; text: string; type: ToastType };

type ToastContextValue = {
  showToast: (text: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, keyof typeof Ionicons.glyphMap> = {
  success: "checkmark-circle",
  error: "alert-circle",
  info: "information-circle",
};

const COLORS: Record<ToastType, string> = {
  success: colors.success,
  error: colors.danger,
  info: colors.accent,
};

const AUTO_DISMISS_MS = 3200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((text: string, type: ToastType = "info") => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, text, type }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {/* React Native (auch via NativeWind auf Web) positioniert "absolute"
          relativ zum unmittelbaren Parent, nicht relativ zum Viewport wie
          reines CSS - ohne dieses explizite flex:1-View als gemeinsamer
          Parent von Inhalt + Toast-Overlay landet der Overlay am oberen
          Rand statt unten. Positionierung bewusst per style-Prop statt
          className: React Native Web setzt fuer absolut positionierte Views
          per Default "top: 0" ueber eine eigene atomare CSS-Klasse, die in
          der Kaskade nach den NativeWind-Utilities kommt und "bottom-0"
          sonst überschreibt. */}
      <View style={{ flex: 1 }}>
        {children}
        <SafeAreaView
          pointerEvents="none"
          style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
          edges={["bottom"]}
        >
          <View className="items-center px-4 pb-4">
            {toasts.map((toast) => (
              <ToastBubble key={toast.id} toast={toast} />
            ))}
          </View>
        </SafeAreaView>
      </View>
    </ToastContext.Provider>
  );
}

function ToastBubble({ toast }: { toast: Toast }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View
      style={{ opacity, transform: [{ translateY }] }}
      className="mt-2 max-w-full flex-row items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-4 py-2.5 shadow-lg"
    >
      <Ionicons name={ICONS[toast.type]} size={16} color={COLORS[toast.type]} />
      <Text className="shrink text-sm text-slate-100">{toast.text}</Text>
    </Animated.View>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast muss innerhalb von <ToastProvider> verwendet werden.");
  return context;
}
