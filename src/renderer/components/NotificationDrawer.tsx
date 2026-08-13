import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  IconButton,
  Image,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useEffect } from 'react';
import { LuCheck, LuExternalLink, LuTrash2, LuX } from 'react-icons/lu';
import { EVENT_LABELS, formatDateTime, relativeTime } from '../../shared/format';
import type { AppNotification } from '../../shared/types';
import { openExternal } from '../lib/api';

const SEVERITY_PALETTE: Record<AppNotification['severity'], string> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

export interface NotificationDrawerProps {
  notification: AppNotification | null;
  onClose: () => void;
  onMarkRead: (notification: AppNotification) => void;
  onDelete: (notification: AppNotification) => void;
}

/** One label/value line in the metadata list. */
function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <Flex gap={3} align="baseline" py={1.5}>
      <Text fontSize="xs" color="fg.subtle" minW="92px" flexShrink={0}>
        {label}
      </Text>
      <Box fontSize="sm" minW={0} wordBreak="break-word">
        {children}
      </Box>
    </Flex>
  );
}

/**
 * Right-hand detail panel.
 *
 * Hand-rolled rather than Chakra's `Drawer`, because this one has to sit inside
 * the custom window frame: it must stop at the titlebar, keep the window's
 * rounded corner, and never cover the resize handles.
 */
export function NotificationDrawer({
  notification,
  onClose,
  onMarkRead,
  onDelete,
}: NotificationDrawerProps): JSX.Element | null {
  const open = notification !== null;

  // Escape closes the panel, which is what every drawer on the desktop does.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!notification) {
    return null;
  }

  const palette = SEVERITY_PALETTE[notification.severity];

  return (
    <>
      <Box
        position="fixed"
        top="var(--titlebar-height, 56px)"
        left="0"
        right="0"
        bottom="0"
        bg="blackAlpha.500"
        zIndex={30}
        onClick={onClose}
        aria-hidden="true"
      />

      <Flex
        direction="column"
        position="fixed"
        top="var(--titlebar-height, 56px)"
        right="0"
        bottom="0"
        w={{ base: '100%', sm: '420px', lg: '460px' }}
        bg="bg.surface"
        borderLeftWidth="1px"
        borderColor="border.subtle"
        boxShadow="-12px 0 32px rgba(0, 0, 0, 0.28)"
        zIndex={31}
        as="section"
        aria-label="Notification details"
      >
        <HStack
          justify="space-between"
          px={4}
          py={3}
          borderBottomWidth="1px"
          borderColor="border.subtle"
          flexShrink={0}
        >
          <HStack gap={2} minW={0}>
            <Badge colorPalette={palette} variant="subtle">
              {EVENT_LABELS[notification.eventType]}
            </Badge>
            {!notification.isRead ? (
              <Badge colorPalette="brand" variant="solid">
                new
              </Badge>
            ) : null}
          </HStack>
          <IconButton aria-label="Close details" size="sm" variant="ghost" onClick={onClose}>
            <Icon as={LuX} />
          </IconButton>
        </HStack>

        <Box flex="1" overflowY="auto" px={4} py={4}>
          <HStack gap={3} align="flex-start" mb={4}>
            {notification.actorAvatarUrl ? (
              <Image
                src={notification.actorAvatarUrl}
                alt=""
                boxSize="36px"
                borderRadius="full"
                flexShrink={0}
              />
            ) : null}
            <Box minW={0}>
              <Text fontSize="sm" fontWeight="600" lineHeight="1.45">
                {notification.message}
              </Text>
              <Text fontSize="xs" color="fg.subtle" mt={1}>
                {relativeTime(notification.createdAt)} · {formatDateTime(notification.createdAt)}
              </Text>
            </Box>
          </HStack>

          {notification.detail ? (
            <Box
              bg="bg.raised"
              borderWidth="1px"
              borderColor="border.subtle"
              borderRadius="card"
              p={3}
              mb={4}
            >
              <Text fontSize="sm" whiteSpace="pre-wrap" lineHeight="1.5">
                {notification.detail}
              </Text>
            </Box>
          ) : null}

          <Stack gap={0} divideY="1px">
            <Row label="Repository">
              <Text
                fontFamily="mono"
                cursor="pointer"
                _hover={{ color: 'brand.fg', textDecoration: 'underline' }}
                onClick={() => openExternal(`https://github.com/${notification.repoName}`)}
              >
                {notification.repoName}
              </Text>
            </Row>

            {notification.prNumber !== null ? (
              <Row label="Pull request">
                <Text fontFamily="mono">#{notification.prNumber}</Text>
              </Row>
            ) : null}

            {notification.prTitle ? <Row label="Title">{notification.prTitle}</Row> : null}

            <Row label="Actor">{notification.actor ?? '—'}</Row>
            <Row label="Event">{EVENT_LABELS[notification.eventType]}</Row>
            <Row label="Severity">
              <Badge colorPalette={palette} variant="subtle" size="sm">
                {notification.severity}
              </Badge>
            </Row>
            <Row label="Detected by">
              <Badge variant="outline" size="sm">
                {notification.source}
              </Badge>
            </Row>
            <Row label="Received">{formatDateTime(notification.createdAt)}</Row>
            <Row label="Read">
              {notification.readAt ? formatDateTime(notification.readAt) : 'not yet'}
            </Row>
            <Row label="Toast shown">{notification.isDelivered ? 'yes' : 'no'}</Row>
            <Row label="Account">{notification.userId}</Row>
            <Row label="Link">
              <Text
                fontSize="xs"
                fontFamily="mono"
                color="brand.fg"
                cursor="pointer"
                _hover={{ textDecoration: 'underline' }}
                onClick={() => openExternal(notification.url)}
              >
                {notification.url}
              </Text>
            </Row>
            {/* Useful when working out why something did or did not appear twice. */}
            <Row label="Dedupe key">
              <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
                {notification.dedupeKey}
              </Text>
            </Row>
          </Stack>
        </Box>

        <HStack
          px={4}
          py={3}
          gap={2}
          borderTopWidth="1px"
          borderColor="border.subtle"
          flexShrink={0}
          flexWrap="wrap"
        >
          <Button
            size="sm"
            colorPalette="brand"
            onClick={() => {
              openExternal(notification.url);
              if (!notification.isRead) {
                onMarkRead(notification);
              }
            }}
          >
            <Icon as={LuExternalLink} />
            Open on GitHub
          </Button>
          {!notification.isRead ? (
            <Button size="sm" variant="outline" onClick={() => onMarkRead(notification)}>
              <Icon as={LuCheck} />
              Mark read
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            colorPalette="red"
            ml="auto"
            onClick={() => onDelete(notification)}
          >
            <Icon as={LuTrash2} />
            Delete
          </Button>
        </HStack>
      </Flex>
    </>
  );
}
