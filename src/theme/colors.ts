export interface ThemeColors {
  mode: "dark" | "light";
  bgPage: string;
  bgCard: string;
  bgElevated: string;
  bgInput: string;
  bgOverlay: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderSubtle: string;
  borderAccent: string;
  accent: string;
  accentFg: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  successBorder: string;
  danger: string;
  dangerSoft: string;
  dangerBorder: string;
  warning: string;
  warningSoft: string;
  warningBorder: string;
}

export const DARK_COLORS: ThemeColors = {
  mode: "dark",
  bgPage: "#030712",
  bgCard: "#070c16",
  bgElevated: "#0b1322",
  bgInput: "#0b1322",
  bgOverlay: "rgba(0, 0, 0, 0.85)",
  textPrimary: "#ffffff",
  textSecondary: "#cbd5e1",
  textMuted: "#94a3b8",
  borderSubtle: "rgba(255, 255, 255, 0.12)",
  borderAccent: "rgba(84, 244, 252, 0.35)",
  accent: "#54f4fc",
  accentFg: "#020617",
  accentSoft: "rgba(84, 244, 252, 0.14)",
  success: "#34d399",
  successSoft: "rgba(16, 185, 129, 0.14)",
  successBorder: "rgba(16, 185, 129, 0.35)",
  danger: "#fb7185",
  dangerSoft: "rgba(244, 63, 94, 0.15)",
  dangerBorder: "rgba(244, 63, 94, 0.35)",
  warning: "#fbbf24",
  warningSoft: "rgba(245, 158, 11, 0.14)",
  warningBorder: "rgba(245, 158, 11, 0.35)",
};

export const LIGHT_COLORS: ThemeColors = {
  mode: "light",
  bgPage: "#f1f5f9",
  bgCard: "#ffffff",
  bgElevated: "#e2e8f0",
  bgInput: "#ffffff",
  bgOverlay: "rgba(15, 23, 42, 0.55)",
  textPrimary: "#0f172a",
  textSecondary: "#334155",
  textMuted: "#475569",
  borderSubtle: "#cbd5e1",
  borderAccent: "rgba(14, 116, 144, 0.35)",
  accent: "#0e7490",
  accentFg: "#ffffff",
  accentSoft: "#ecfeff",
  success: "#047857",
  successSoft: "#ecfdf5",
  successBorder: "#a7f3d0",
  danger: "#be123c",
  dangerSoft: "#fff1f2",
  dangerBorder: "#fecdd3",
  warning: "#b45309",
  warningSoft: "#fffbeb",
  warningBorder: "#fde68a",
};
