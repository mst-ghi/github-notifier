import { Badge, Box, Flex, HStack, Icon, Image, Separator, Stack, Text } from '@chakra-ui/react';
import { type ReactNode, useEffect, useState } from 'react';
import { LuBell, LuFolderGit2, LuSettings, LuTriangleAlert, LuUser } from 'react-icons/lu';
import { NavLink, useLocation } from 'react-router-dom';
import { badgeText } from '../../shared/format';
import type { DaemonStatus } from '../../shared/types';
import { invoke } from '../lib/api';
import { WindowFrame } from './WindowFrame';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LuBell;
  /** Red count, for things needing attention. */
  badge?: number;
  /** Neutral count, for totals that are informational rather than urgent. */
  info?: number;
  infoTitle?: string;
  /** Shown instead of the icon, for the signed-in account. */
  avatarUrl?: string;
}

export interface AppShellProps {
  children: ReactNode;
  unread: number;
  status: DaemonStatus | null;
  /** Open pull requests across every watched repository. */
  openPullRequests: number;
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
  openPullRequests,
  onTogglePause,
}: AppShellProps): JSX.Element {
  const location = useLocation();
  const [version, setVersion] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  useEffect(() => {
    void invoke('app:version')
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  // The avatar makes the sidebar entry read as "you" rather than as a generic
  // settings page. Failing to load it just leaves the icon in place.
  useEffect(() => {
    if (!status?.authenticatedAs) {
      return;
    }
    void invoke('profile:overview')
      .then((overview) => setAvatarUrl(overview.user?.avatarUrl ?? ''))
      .catch(() => undefined);
  }, [status?.authenticatedAs]);

  const items: NavItem[] = [
    {
      to: '/',
      label: 'Repositories',
      icon: LuFolderGit2,
      info: openPullRequests,
      infoTitle: 'Open pull requests across watched repositories',
    },
    { to: '/notifications', label: 'Notifications', icon: LuBell, badge: unread },
    {
      to: '/profile',
      label: status?.authenticatedAs ?? 'Profile',
      icon: LuUser,
      avatarUrl,
    },
    { to: '/settings', label: 'Settings', icon: LuSettings },
  ];

  return (
    <WindowFrame status={status} onTogglePause={onTogglePause}>
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
              item.to === '/'
                ? location.pathname === '/' || location.pathname.startsWith('/repos')
                : location.pathname.startsWith(item.to);
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
                  {item.avatarUrl ? (
                    <Image
                      src={item.avatarUrl}
                      alt=""
                      boxSize={4}
                      borderRadius="full"
                      flexShrink={0}
                    />
                  ) : (
                    <Icon as={item.icon} boxSize={4} />
                  )}
                  <Text truncate>{item.label}</Text>
                  {item.badge ? (
                    <Badge colorPalette="red" variant="solid" borderRadius="full" ml="auto">
                      {badgeText(item.badge)}
                    </Badge>
                  ) : null}
                  {!item.badge && item.info ? (
                    <Badge variant="subtle" borderRadius="full" ml="auto" title={item.infoTitle}>
                      {badgeText(item.info)}
                    </Badge>
                  ) : null}
                </HStack>
              </NavLink>
            );
          })}

          <Box display={{ base: 'none', md: 'block' }} mt="auto" pt={4}>
            <StatusStrip status={status} version={version} />
          </Box>
        </Stack>

        <Box flex="1" minW={0} overflowY="auto" p={{ base: 3, md: 6 }}>
          {children}
          <Box display={{ base: 'block', md: 'none' }} mt={6}>
            <StatusStrip status={status} version={version} />
          </Box>
        </Box>
      </Flex>
    </WindowFrame>
  );
}

/**
 * Compact health readout.
 *
 * There is no database row: storage is a local file that is either there or the
 * app is not running at all, so a permanent green line said nothing useful. A
 * genuine database failure still surfaces as a banner on the Repositories page.
 */
export function StatusStrip({
  status,
  version,
}: {
  status: DaemonStatus | null;
  version?: string;
}): JSX.Element {
  const daemonUp = status?.reachable ?? false;
  const mismatched = Boolean(version && daemonUp && status && status.version !== version);
  const rows: Array<{ label: string; ok: boolean; detail: string }> = [
    {
      label: 'Background service',
      ok: daemonUp,
      detail: daemonUp ? 'running' : 'stopped',
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

      {version ? (
        <>
          <Separator />
          <HStack justify="space-between" gap={2}>
            <Text fontFamily="mono">v{version}</Text>
            {/*
              The window and the service are separate programs and are updated
              separately, so they can genuinely disagree. Saying so here is the
              only place a user would find out before something breaks.
            */}
            {mismatched ? (
              <HStack
                gap={1}
                color="orange.fg"
                title={`The background service is running v${status?.version}. Restart it after installing an update.`}
              >
                <Icon as={LuTriangleAlert} boxSize={3} />
                <Text fontFamily="mono">service v{status?.version}</Text>
              </HStack>
            ) : null}
          </HStack>
        </>
      ) : null}
    </Stack>
  );
}
