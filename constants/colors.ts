export const colors = {
  background: "#0F172A",
  surface: "#1E293B",
  surfaceAlt: "#334155",
  border: "#334155",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  accent: "#38BDF8",
  success: "#4ADE80",
  warning: "#FACC15",
  danger: "#F87171",
} as const;

export type ColorName = keyof typeof colors;
