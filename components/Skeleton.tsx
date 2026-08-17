import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

// Einfacher Puls-Skeleton (Opacity-Loop) statt Vollbild-Spinner beim ersten
// Laden - zeigt schon die grobe Form des Inhalts, wirkt weniger wie ein
// Warten-auf-nichts. NativeWind's `animate-pulse` ist eine Web-only
// Tailwind-Klasse, deshalb hier bewusst mit RN Animated (funktioniert
// gleichermassen auf Web und nativ).
function usePulse() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return opacity;
}

function SkeletonBlock({ className }: { className: string }) {
  const opacity = usePulse();
  return <Animated.View style={{ opacity }} className={`rounded-lg bg-slate-700 ${className}`} />;
}

export function SkeletonCard() {
  return (
    <View className="mx-4 mb-3 rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <View className="flex-row items-center gap-2">
        <SkeletonBlock className="h-4 w-4" />
        <SkeletonBlock className="h-4 w-32" />
      </View>
      <SkeletonBlock className="mt-3 h-3 w-full" />
      <SkeletonBlock className="mt-2 h-3 w-2/3" />
    </View>
  );
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <View className="pt-2">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}
