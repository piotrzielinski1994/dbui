import {
  ThemeProvider as BaseThemeProvider,
  type ThemeContextValue,
  useTheme as useBaseTheme,
  useThemeOptional as useBaseThemeOptional,
  useThemeToggle as useBaseThemeToggle,
} from "@pziel/pureui";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { ThemeColors } from "@/lib/settings/settings";
import { useSettings } from "@/lib/settings/settings-context";
import { applyThemeVars } from "@/lib/theme/apply-vars";
import { applyDefaults } from "@/lib/theme/overrides";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

const computeEffectiveColors = (colors: ThemeColors): ThemeColors =>
  applyDefaults(colors, DEFAULT_THEME_COLORS);

// Thin wrapper over pureui's generic ThemeProvider: wires this app's settings +
// color subsystem (savers, inline-var writer, defaults merge) into the shared
// provider that owns mode resolution and the `.dark` toggle.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, saveThemeMode, saveThemeColors } = useSettings();
  return (
    <BaseThemeProvider<ThemeColors>
      mode={settings.theme.mode}
      colors={settings.theme.colors}
      setMode={saveThemeMode}
      setColors={saveThemeColors}
      computeEffectiveColors={computeEffectiveColors}
      applyVars={applyThemeVars}
    >
      {children}
    </BaseThemeProvider>
  );
}

export function useTheme(): ThemeContextValue<ThemeColors> {
  return useBaseTheme<ThemeColors>();
}

export function useThemeOptional(): ThemeContextValue<ThemeColors> | null {
  return useBaseThemeOptional<ThemeColors>();
}

// Cycle the mode and toast the new mode via sonner. Shared by the Cmd/Ctrl+Shift+L
// shortcut and the "Toggle theme" palette command; the toast emitter is injected
// into pureui's toast-agnostic hook so the shared provider never depends on sonner.
export function useThemeToggle(): () => void {
  return useBaseThemeToggle(toast);
}
