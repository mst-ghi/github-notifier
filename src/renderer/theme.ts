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
        mono: {
          value: '"Fira Code", "JetBrains Mono", "Noto Sans Mono", "DejaVu Sans Mono", monospace',
        },
        /*
         * The display face is monospaced on purpose. This is a tool that lives
         * next to a terminal, and its own vernacular — branch names, SHAs,
         * owner/repo — is already monospaced, so headings in the same voice
         * read as part of the subject rather than as decoration.
         */
        display: {
          value: '"Fira Code", "JetBrains Mono", "Noto Sans Mono", "DejaVu Sans Mono", monospace',
        },
      },
      radii: {
        card: { value: '12px' },
      },
      shadows: {
        // Deeper and softer than the default: a matte surface should absorb
        // the shadow rather than let it ring around the window edge.
        window: { value: '0 20px 56px rgba(0, 0, 0, 0.55)' },
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
        /*
         * Dark mode is matte black: neutral greys with no hue, and never pure
         * #000 — true black reads as glossy on an OLED panel and makes the
         * elevation steps between surfaces invisible. Each step is a few
         * percent lighter than the last, which is what gives the flat, powdery
         * look rather than a shiny one.
         */
        bg: {
          canvas: { value: { base: '{colors.gray.50}', _dark: '#0b0b0c' } },
          surface: { value: { base: 'white', _dark: '#141415' } },
          raised: { value: { base: 'white', _dark: '#1d1d1f' } },
          sidebar: { value: { base: 'white', _dark: '#0e0e10' } },
        },
        fg: {
          // Neutral off-white rather than Chakra's grays, which carry a blue
          // cast that fights the matte surface.
          default: { value: { base: '{colors.gray.900}', _dark: '#ededee' } },
          subtle: { value: { base: '{colors.gray.600}', _dark: '#9c9ca0' } },
        },
        border: {
          subtle: { value: { base: '{colors.gray.200}', _dark: '#282829' } },
        },
        // GitHub's own green, because this is the colour the audience already
        // reads as "this part is working".
        success: {
          solid: { value: { base: '#1a7f37', _dark: '#3fb950' } },
          subtle: { value: { base: '#dafbe1', _dark: '#0f2915' } },
          fg: { value: { base: '#1a7f37', _dark: '#56d364' } },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
