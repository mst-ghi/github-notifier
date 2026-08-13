import { Badge, Box, Flex, HStack, Icon, IconButton, Image, Stack, Text } from '@chakra-ui/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  LuBell,
  LuFolderGit2,
  LuMonitor,
  LuMoon,
  LuPause,
  LuPlay,
  LuSettings,
  LuSun,
} from 'react-icons/lu';
import { NavLink, useLocation } from 'react-router-dom';
import { badgeText } from '../../shared/format';
import type { DaemonStatus } from '../../shared/types';
import logoUrl from '../assets/logo.png';
import { useIpcEvent } from '../hooks/useIpc';
import { invoke } from '../lib/api';
import { useColorMode } from './Provider';
import { ResizeBorders } from './ResizeBorders';
import { WindowControls } from './WindowControls';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LuBell;
  badge?: number;
}

export interface AppShellProps {
  children: ReactNode;
  unread: number;
  status: DaemonStatus | null;
  /** This window's own MongoDB connection, not the daemon's. */
  dbConnected: boolean;
  onTogglePause: () => void;
}

/**
 * The window itself, not just a layout.
 *
 * The BrowserWindow is frameless and transparent, so everything a normal title
 * bar gives you is drawn here: rounded corners, a border, the drag region, the
 * minimise/maximise/close buttons and the resize handles. Corners are squared
 * off while maximised, because rounded corners against a screen edge look like
 * a rendering bug.
 *
 * Layout is responsive by breakpoint rather than by JS: at `md` and up the nav
 * is a left rail, below that it becomes a horizontal strip under the header, so
 * the window stays usable when it is dragged narrow.
 */
export function AppShell({
  children,
  unread,
  status,
  dbConnected,
  onTogglePause,
}: AppShellProps): JSX.Element {
  const location = useLocation();
  const { resolved, preference, setColorMode } = useColorMode();
  const [maximized, setMaximized] = useState(false);
  const headerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void invoke('window:isMaximized').then(setMaximized);
  }, []);

  // Anything that overlays the app (the notification drawer) has to start below
  // the titlebar, or it covers the window controls. The height changes with the
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
  useIpcEvent('event:maximizeChanged', setMaximized);

  const items: NavItem[] = [
    { to: '/', label: 'Repositories', icon: LuFolderGit2 },
    { to: '/notifications', label: 'Notifications', icon: LuBell, badge: unread },
    { to: '/settings', label: 'Settings', icon: LuSettings },
  ];

  const cycleColorMode = (): void => {
    const order = ['system', 'light', 'dark'] as const;
    const index = order.indexOf(preference);
    const next = order[(index + 1) % order.length];
    setColorMode(next);
  };

  const ColorModeIcon = preference === 'system' ? LuMonitor : resolved === 'dark' ? LuMoon : LuSun;
  const paused = status?.paused ?? false;

  // Double-clicking the drag region is the standard way to toggle maximise.
  const handleTitlebarDoubleClick = (): void => {
    void invoke('window:toggleMaximize').then(setMaximized);
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
        boxShadow={maximized ? 'none' : '0 18px 50px rgba(0, 0, 0, 0.38)'}
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
          onDoubleClick={handleTitlebarDoubleClick}
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
                {status?.authenticatedAs
                  ? `Signed in as ${status.authenticatedAs}`
                  : 'Not signed in'}
              </Text>
            </Box>
          </HStack>

          <HStack gap={0} flexShrink={0} alignSelf="stretch">
            <HStack gap={1} pr={2} alignSelf="center">
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

        <Flex flex="1" minH={0} direction={{ base: 'column', md: 'row' }}>
          <Stack
            as="nav"
            direction={{ base: 'row', md: 'column' }}
            w={{ base: 'full', md: '232px' }}
            flexShrink={0}
            gap={1}
            p={{ base: 2, md: 3 }}
            bg="bg.sidebar"
            borderRightWidth={{ base: 0, md: '1px' }}
            borderBottomWidth={{ base: '1px', md: 0 }}
            borderColor="border.subtle"
            overflowX={{ base: 'auto', md: 'visible' }}
          >
            {items.map((item) => {
              const active =
                item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
              return (
                <NavLink key={item.to} to={item.to} style={{ textDecoration: 'none' }}>
                  <HStack
                    gap={3}
                    px={3}
                    py={2.5}
                    borderRadius="md"
                    bg={active ? 'brand.muted' : 'transparent'}
                    color={active ? 'brand.fg' : 'fg.default'}
                    fontWeight={active ? '600' : '500'}
                    fontSize="sm"
                    _hover={{ bg: active ? 'brand.muted' : 'bg.raised' }}
                    whiteSpace="nowrap"
                    transition="background 120ms"
                  >
                    <Icon as={item.icon} boxSize={4} />
                    <Text>{item.label}</Text>
                    {item.badge ? (
                      <Badge colorPalette="red" variant="solid" borderRadius="full" ml="auto">
                        {badgeText(item.badge)}
                      </Badge>
                    ) : null}
                  </HStack>
                </NavLink>
              );
            })}

            <Box display={{ base: 'none', md: 'block' }} mt="auto" pt={4}>
              <StatusStrip status={status} dbConnected={dbConnected} />
            </Box>
          </Stack>

          <Box flex="1" minW={0} overflowY="auto" p={{ base: 3, md: 6 }}>
            {children}
            <Box display={{ base: 'block', md: 'none' }} mt={6}>
              <StatusStrip status={status} dbConnected={dbConnected} />
            </Box>
          </Box>
        </Flex>
      </Flex>

      <ResizeBorders maximized={maximized} />
    </Box>
  );
}

/**
 * Compact health readout.
 *
 * The MongoDB row reports *this window's* connection, because that is the one
 * the user's edits go through and it is known even when the daemon is down.
 * Reading it off the daemon status instead would show a healthy database as
 * "offline" whenever the service was simply not running.
 */
export function StatusStrip({
  status,
  dbConnected,
}: {
  status: DaemonStatus | null;
  dbConnected: boolean;
}): JSX.Element {
  const daemonUp = status?.reachable ?? false;
  const rows: Array<{ label: string; ok: boolean; detail: string }> = [
    {
      label: 'Background service',
      ok: daemonUp,
      detail: daemonUp ? 'running' : 'stopped',
    },
    {
      label: 'MongoDB',
      ok: dbConnected,
      detail: dbConnected ? 'connected' : 'offline',
    },
    {
      label: 'Webhook',
      ok: status?.webhookListening ?? false,
      detail: !daemonUp
        ? 'service stopped'
        : status?.webhookListening
          ? `port ${status.webhookPort}`
          : 'polling only',
    },
  ];

  return (
    <Stack gap={2} fontSize="xs" color="fg.subtle">
      {rows.map((row) => (
        <HStack key={row.label} justify="space-between" gap={2}>
          <HStack gap={2} minW={0}>
            <Box
              boxSize="8px"
              borderRadius="full"
              bg={row.ok ? 'green.500' : 'orange.400'}
              flexShrink={0}
            />
            <Text truncate>{row.label}</Text>
          </HStack>
          <Text flexShrink={0}>{row.detail}</Text>
        </HStack>
      ))}
      {status?.rateLimit ? (
        <HStack justify="space-between">
          <Text>API quota</Text>
          <Text>
            {status.rateLimit.remaining}/{status.rateLimit.limit}
          </Text>
        </HStack>
      ) : null}
    </Stack>
  );
}
