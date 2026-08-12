import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

/**
 * Brand palette taken from the app logo (the blue megaphone): a mid blue for
 * primary actions and a darker blue for pressed/hover states.
 */
const config = defineConfig({
  globalCss: {
    'html, body, #root': {
      height: '100%',
    },
    // The window is frameless and transparent, so `body` must stay see-through
    // for the rounded corners on the shell below it to be visible.
    body: {
      bg: 'transparent',
      color: 'fg.default',
      overflow: 'hidden',
    },

    '::-webkit-scrollbar': { width: '10px', height: '10px' },
    '::-webkit-scrollbar-thumb': {
      bg: 'border.subtle',
      borderRadius: 'full',
    },
    '::-webkit-scrollbar-track': { bg: 'transparent' },
  },
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: '#eef3ff' },
          100: { value: '#dbe5ff' },
          200: { value: '#bcd0ff' },
          300: { value: '#8eb0ff' },
          400: { value: '#5b85fb' },
          500: { value: '#2f5cf5' },
          600: { value: '#2145e6' },
          700: { value: '#1c37c4' },
          800: { value: '#1c319f' },
          900: { value: '#1c2f7d' },
          950: { value: '#141d4c' },
        },
      },
      fonts: {
        heading: { value: 'Inter, "Noto Sans", system-ui, sans-serif' },
        body: { value: 'Inter, "Noto Sans", system-ui, sans-serif' },
        mono: { value: '"JetBrains Mono", "DejaVu Sans Mono", monospace' },
      },
      radii: {
        card: { value: '12px' },
      },
    },
    semanticTokens: {
      colors: {
        brand: {
          solid: { value: { base: '{colors.brand.600}', _dark: '{colors.brand.500}' } },
          contrast: { value: '#ffffff' },
          fg: { value: { base: '{colors.brand.700}', _dark: '{colors.brand.300}' } },
          muted: { value: { base: '{colors.brand.50}', _dark: '{colors.brand.950}' } },
          subtle: { value: { base: '{colors.brand.100}', _dark: '{colors.brand.900}' } },
          emphasized: { value: { base: '{colors.brand.200}', _dark: '{colors.brand.800}' } },
          focusRing: { value: { base: '{colors.brand.500}', _dark: '{colors.brand.400}' } },
        },
        bg: {
          canvas: { value: { base: '{colors.gray.50}', _dark: '#0d1017' } },
          surface: { value: { base: 'white', _dark: '#141924' } },
          raised: { value: { base: 'white', _dark: '#1b2130' } },
          sidebar: { value: { base: 'white', _dark: '#10141d' } },
        },
        fg: {
          default: { value: { base: '{colors.gray.900}', _dark: '{colors.gray.100}' } },
          subtle: { value: { base: '{colors.gray.600}', _dark: '{colors.gray.400}' } },
        },
        border: {
          subtle: { value: { base: '{colors.gray.200}', _dark: '#232b3a' } },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
