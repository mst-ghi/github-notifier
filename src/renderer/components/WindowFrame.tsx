import { Box, Flex, HStack, Icon, IconButton, Image, Text } from '@chakra-ui/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { LuMonitor, LuMoon, LuPause, LuPlay, LuSun } from 'react-icons/lu';
import type { DaemonStatus } from '../../shared/types';
import logoUrl from '../assets/logo.png';
import { useIpcEvent } from '../hooks/useIpc';
import { invoke } from '../lib/api';
import { useColorMode } from './Provider';
import { ResizeBorders } from './ResizeBorders';
import { WindowControls } from './WindowControls';

export interface WindowFrameProps {
  children: ReactNode;
  status: DaemonStatus | null;
  onTogglePause: () => void;
  /** Hidden during setup, where pausing makes no sense yet. */
  showPauseButton?: boolean;
  /** Replaces the "Signed in as …" line. */
  subtitle?: string;
}

/**
 * The window itself: rounded corners, border, drag region, window controls and
 * resize handles.
 *
 * Both the main app and first-run setup render inside this, so the chrome is
 * defined once. Corners square off while maximised, because rounded corners
 * against a screen edge look like a rendering bug.
 */
export function WindowFrame({
  children,
  status,
  onTogglePause,
  showPauseButton = true,
  subtitle,
}: WindowFrameProps): JSX.Element {
  const { resolved, preference, setColorMode } = useColorMode();
  const [maximized, setMaximized] = useState(false);
  const headerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void invoke('window:isMaximized').then(setMaximized);
  }, []);
  useIpcEvent('event:maximizeChanged', setMaximized);

  // Anything that overlays the app (the drawers) has to start below the
  // titlebar, or it covers the window controls. The height changes with the
  // breakpoint, so it is measured rather than hard-coded.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }
    const publish = (): void => {
      document.documentElement.style.setProperty(
        '--titlebar-height',
        `${Math.round(header.getBoundingClientRect().height)}px`
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const ColorModeIcon = preference === 'system' ? LuMonitor : resolved === 'dark' ? LuMoon : LuSun;
  const paused = status?.paused ?? false;

  const cycleColorMode = (): void => {
    const order = ['system', 'light', 'dark'] as const;
    const next = order[(order.indexOf(preference) + 1) % order.length];
    setColorMode(next);
  };

  return (
    <Box position="relative" h="100vh" w="100vw" overflow="hidden">
      <Flex
        direction="column"
        h="100%"
        w="100%"
        bg="bg.canvas"
        color="fg.default"
        borderRadius={maximized ? 0 : '10px'}
        borderWidth={maximized ? 0 : '1px'}
        borderColor="border.subtle"
        overflow="hidden"
        boxShadow={maximized ? 'none' : 'window'}
      >
        <Flex
          as="header"
          ref={headerRef}
          className="window-drag"
          align="center"
          justify="space-between"
          pl={{ base: 3, md: 4 }}
          borderBottomWidth="1px"
          borderColor="border.subtle"
          bg="bg.surface"
          gap={3}
          flexShrink={0}
          position="relative"
          zIndex={20}
          onDoubleClick={() => {
            void invoke('window:toggleMaximize').then(setMaximized);
          }}
        >
          <HStack gap={3} minW={0} py={2}>
            <Image src={logoUrl} alt="" boxSize={{ base: '22px', md: '26px' }} draggable={false} />
            <Box minW={0}>
              <Text fontWeight="700" fontSize={{ base: 'xs', md: 'sm' }} lineHeight="1.2">
                GitHub Notifier
              </Text>
              <Text
                fontSize="xs"
                color="fg.subtle"
                display={{ base: 'none', sm: 'block' }}
                truncate
              >
                {subtitle ??
                  (status?.authenticatedAs
                    ? `Signed in as ${status.authenticatedAs}`
                    : 'Not signed in')}
              </Text>
            </Box>
          </HStack>

          <HStack gap={0} flexShrink={0} alignSelf="stretch">
            <HStack gap={1} pr={2} alignSelf="center">
              {showPauseButton ? (
                <IconButton
                  aria-label={paused ? 'Resume monitoring' : 'Pause monitoring'}
                  title={paused ? 'Resume monitoring' : 'Pause monitoring'}
                  variant="ghost"
                  size="sm"
                  onClick={onTogglePause}
                  disabled={!status?.reachable}
                >
                  <Icon as={paused ? LuPlay : LuPause} />
                </IconButton>
              ) : null}
              <IconButton
                aria-label={`Colour mode: ${preference}`}
                title={`Colour mode: ${preference} (click to change)`}
                variant="ghost"
                size="sm"
                onClick={cycleColorMode}
              >
                <Icon as={ColorModeIcon} />
              </IconButton>
            </HStack>

            <Box w="1px" alignSelf="stretch" my={2} bg="border.subtle" />

            <WindowControls maximized={maximized} onMaximizeChange={setMaximized} />
          </HStack>
        </Flex>

        {children}
      </Flex>

      <ResizeBorders maximized={maximized} />
    </Box>
  );
}

/** The frame with no navigation, used while first-run setup is showing. */
export function SetupShell({
  children,
  status,
  onTogglePause,
}: {
  children: ReactNode;
  status: DaemonStatus | null;
  onTogglePause: () => void;
}): JSX.Element {
  return (
    <WindowFrame
      status={status}
      onTogglePause={onTogglePause}
      showPauseButton={false}
      subtitle="Setup"
    >
      <Box flex="1" minH={0} overflowY="auto">
        <Box minH="100%">{children}</Box>
      </Box>
    </WindowFrame>
  );
}
