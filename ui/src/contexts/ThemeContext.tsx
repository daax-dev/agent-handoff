import { createContext, useContext, useState, type ReactNode } from "react";

export interface FSMPalette {
  // Layout surfaces
  canvasBg:     string;
  headerBg:     string;
  headerBorder: string;
  // Text
  text:         string;
  textMuted:    string;
  // Node surfaces
  nodeBg:       string;
  nodeDivider:  string;
  // Inputs / panels
  inputBg:      string;
  inputBorder:  string;
  panelBg:      string;
  panelBorder:  string;
  // Semantic accents — identical in both modes
  amber:        string;
  amberBright:  string;
  blue:         string;
  blueBright:   string;
  red:          string;
  redBright:    string;
  green:        string;
  orange:       string;
  // State-specific text colors (lighter in dark, darker in light)
  textAmber:    string;
  textGreen:    string;
  textRed:      string;
  textOrange:   string;
  textBlue:     string;
  glow:         string;
  // ReactFlow internals
  rfColorMode:  "dark" | "light";
  bgDots:       string;
  minimapMask:  string;
  minimapBg:    string;
}

const DARK: FSMPalette = {
  canvasBg:    "#0c0c0c",
  headerBg:    "#111111",
  headerBorder:"#1f1f1f",
  text:        "#f5f5f5",
  textMuted:   "#737373",
  nodeBg:      "#161616",
  nodeDivider: "#2a2a2a",
  inputBg:     "#1a1a1a",
  inputBorder: "#2a2a2a",
  panelBg:     "#111111",
  panelBorder: "#2a2a2a",
  amber:       "#d97706",
  amberBright: "#f59e0b",
  blue:        "#2563eb",
  blueBright:  "#3b82f6",
  red:         "#b91c1c",
  redBright:   "#ef4444",
  green:       "#15803d",
  orange:      "#c2410c",
  textAmber:   "#fbbf24",
  textGreen:   "#4ade80",
  textRed:     "#f87171",
  textOrange:  "#fb923c",
  textBlue:    "#93c5fd",
  glow:        "rgba(245,158,11,0.18)",
  rfColorMode: "dark",
  bgDots:      "#2a2a2a",
  minimapMask: "rgba(0,0,0,0.65)",
  minimapBg:   "#0c0c0c",
};

const LIGHT: FSMPalette = {
  canvasBg:    "#f0f0f0",
  headerBg:    "#ffffff",
  headerBorder:"#e5e7eb",
  text:        "#111111",
  textMuted:   "#6b7280",
  nodeBg:      "#ffffff",
  nodeDivider: "#e5e7eb",
  inputBg:     "#f9fafb",
  inputBorder: "#d1d5db",
  panelBg:     "#ffffff",
  panelBorder: "#e5e7eb",
  amber:       "#d97706",
  amberBright: "#f59e0b",
  blue:        "#2563eb",
  blueBright:  "#3b82f6",
  red:         "#b91c1c",
  redBright:   "#ef4444",
  green:       "#15803d",
  orange:      "#c2410c",
  textAmber:   "#b45309",
  textGreen:   "#15803d",
  textRed:     "#dc2626",
  textOrange:  "#c2410c",
  textBlue:    "#1d4ed8",
  glow:        "rgba(217,119,6,0.12)",
  rfColorMode: "light",
  bgDots:      "#c7c7c7",
  minimapMask: "rgba(240,240,240,0.6)",
  minimapBg:   "#e8e8e8",
};

interface ThemeCtx {
  isDark: boolean;
  palette: FSMPalette;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx>({
  isDark: true,
  palette: DARK,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem("fsm-theme") !== "light"; } catch { return true; }
  });

  function toggleTheme() {
    setIsDark((prev) => {
      const next = !prev;
      try { localStorage.setItem("fsm-theme", next ? "dark" : "light"); } catch {}
      return next;
    });
  }

  return (
    <ThemeContext.Provider value={{ isDark, palette: isDark ? DARK : LIGHT, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
