import { ChakraProvider } from '@chakra-ui/react';
import { ThemeProvider, useTheme } from 'next-themes';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { system } from '../theme';

/**
 * Colour mode is stored by next-themes under `gh-notifier-theme`, which is the
 * same key the inline script in index.html reads before first paint.
 */
export function Provider({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ChakraProvider value={system}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        storageKey="gh-notifier-theme"
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </ChakraProvider>
  );
}

export type ColorMode = 'light' | 'dark' | 'system';

export interface ColorModeApi {
  /** What the user picked, including "system". */
  preference: ColorMode;
  /** What is actually on screen right now. Never "system". */
  resolved: 'light' | 'dark';
  setColorMode: (mode: ColorMode) => void;
  toggle: () => void;
}

export function useColorMode(): ColorModeApi {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const resolved = resolvedTheme === 'light' ? 'light' : 'dark';

  const setColorMode = useCallback(
    (mode: ColorMode) => {
      setTheme(mode);
    },
    [setTheme]
  );

  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  return {
    preference: (theme as ColorMode | undefined) ?? 'system',
    resolved,
    setColorMode,
    toggle,
  };
}
