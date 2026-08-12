import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  NativeSelect,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useCallback, useMemo, useState } from 'react';
import { LuCheck, LuCheckCheck, LuExternalLink, LuTrash2 } from 'react-icons/lu';
import { EVENT_TYPES } from '../../shared/constants';
import { EVENT_LABELS, formatDateTime, relativeTime } from '../../shared/format';
import type { AppNotification, EventType, NotificationQuery } from '../../shared/types';
import { Card, EmptyState, ErrorBanner, LoadingBlock, PageHeader } from '../components/Common';
import { useToast } from '../components/Toaster';
import { useAsync, useDebounced, useIpcEvent } from '../hooks/useIpc';
import { invoke, openExternal } from '../lib/api';

const PAGE_SIZE = 30;

const SEVERITY_PALETTE: Record<AppNotification['severity'], string> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

export interface NotificationsPageProps {
  onUnreadChange: (count: number) => void;
}

export function NotificationsPage({ onUnreadChange }: NotificationsPageProps): JSX.Element {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [repoFilter, setRepoFilter] = useState('');
  const [eventFilter, setEventFilter] = useState<EventType | ''>('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(0);
  const debouncedSearch = useDebounced(search, 300);

  const query = useMemo<NotificationQuery>(
    () => ({
      search: debouncedSearch || undefined,
      repoName: repoFilter || undefined,
      eventTypes: eventFilter ? [eventFilter] : undefined,
      isRead: unreadOnly ? false : undefined,
      limit: PAGE_SIZE,
      skip: page * PAGE_SIZE,
      sort: 'newest',
    }),
    [debouncedSearch, repoFilter, eventFilter, unreadOnly, page]
  );

  const { data, loading, error, reload, setData } = useAsync(
    () => invoke('notifications:query', query),
    [query]
  );
  const facets = useAsync(() => invoke('notifications:repoFacets'), []);

  // A new notification arriving while the list is open should show up without
  // the user having to refresh.
  useIpcEvent('event:notification', () => {
    void reload();
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const applyUnread = useCallback(
    (count: number) => {
      onUnreadChange(count);
    },
    [onUnreadChange]
  );

  const handleOpen = async (notification: AppNotification): Promise<void> => {
    openExternal(notification.url);
    if (!notification.isRead) {
      await invoke('notifications:markRead', [notification.id]);
      setData({
        ...(data ?? { items: [], total: 0, unread: 0, limit: PAGE_SIZE, skip: 0 }),
        items: items.map((item) =>
          item.id === notification.id ? { ...item, isRead: true } : item
        ),
      });
      applyUnread(await invoke('notifications:unreadCount'));
    }
  };

  const handleMarkRead = async (notification: AppNotification): Promise<void> => {
    await invoke('notifications:markRead', [notification.id]);
    await reload();
    applyUnread(await invoke('notifications:unreadCount'));
  };

  const handleDelete = async (notification: AppNotification): Promise<void> => {
    await invoke('notifications:delete', [notification.id]);
    await reload();
    applyUnread(await invoke('notifications:unreadCount'));
  };

  const handleMarkAllRead = async (): Promise<void> => {
    const changed = await invoke('notifications:markAllRead');
    await reload();
    applyUnread(0);
    toast.success(`Marked ${changed} notifications as read`);
  };

  const handleClearAll = async (): Promise<void> => {
    const removed = await invoke('notifications:clearAll');
    await reload();
    applyUnread(0);
    toast.info(`Deleted ${removed} notifications`);
  };

  return (
    <Box>
      <PageHeader
        title="Notifications"
        description={`${total} notification${total === 1 ? '' : 's'} in history`}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => void handleMarkAllRead()}>
              <Icon as={LuCheckCheck} />
              Mark all read
            </Button>
            <Button
              size="sm"
              variant="outline"
              colorPalette="red"
              onClick={() => void handleClearAll()}
            >
              <Icon as={LuTrash2} />
              Clear all
            </Button>
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <Flex gap={2} mb={4} direction={{ base: 'column', md: 'row' }} flexWrap="wrap">
        <Input
          placeholder="Search messages, titles, repositories…"
          value={search}
          onChange={(event) => {
            setPage(0);
            setSearch(event.target.value);
          }}
          size="sm"
          flex={{ base: 'auto', md: '1 1 260px' }}
        />

        <NativeSelect.Root size="sm" width={{ base: 'full', md: '200px' }}>
          <NativeSelect.Field
            value={repoFilter}
            onChange={(event) => {
              setPage(0);
              setRepoFilter(event.currentTarget.value);
            }}
          >
            <option value="">All repositories</option>
            {(facets.data ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <NativeSelect.Root size="sm" width={{ base: 'full', md: '190px' }}>
          <NativeSelect.Field
            value={eventFilter}
            onChange={(event) => {
              setPage(0);
              setEventFilter(event.currentTarget.value as EventType | '');
            }}
          >
            <option value="">All event types</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVENT_LABELS[type]}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <Button
          size="sm"
          variant={unreadOnly ? 'solid' : 'outline'}
          colorPalette={unreadOnly ? 'brand' : 'gray'}
          onClick={() => {
            setPage(0);
            setUnreadOnly((current) => !current);
          }}
        >
          Unread only
        </Button>
      </Flex>

      {loading && items.length === 0 ? (
        <LoadingBlock label="Loading notifications…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="Notifications appear once a watched repository has activity on your pull requests."
        />
      ) : (
        <Stack gap={2}>
          {items.map((notification) => (
            <Card
              key={notification.id}
              borderLeftWidth="3px"
              borderLeftColor={
                notification.isRead
                  ? 'transparent'
                  : `${SEVERITY_PALETTE[notification.severity]}.500`
              }
              _hover={{ borderColor: 'brand.emphasized' }}
              transition="border-color 120ms"
            >
              <Flex
                px={4}
                py={3}
                gap={3}
                align="flex-start"
                direction={{ base: 'column', sm: 'row' }}
              >
                <Box
                  flex="1"
                  minW={0}
                  cursor="pointer"
                  onClick={() => void handleOpen(notification)}
                >
                  <HStack gap={2} flexWrap="wrap" mb={1}>
                    <Badge
                      size="sm"
                      colorPalette={SEVERITY_PALETTE[notification.severity]}
                      variant="subtle"
                    >
                      {EVENT_LABELS[notification.eventType]}
                    </Badge>
                    <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                      {notification.repoName}
                      {notification.prNumber !== null ? ` #${notification.prNumber}` : ''}
                    </Text>
                    {!notification.isRead ? (
                      <Badge size="sm" colorPalette="brand" variant="solid">
                        new
                      </Badge>
                    ) : null}
                  </HStack>

                  <Text
                    fontSize="sm"
                    fontWeight={notification.isRead ? '400' : '600'}
                    lineHeight="1.45"
                  >
                    {notification.message}
                  </Text>

                  {notification.prTitle ? (
                    <Text fontSize="xs" color="fg.subtle" mt={1} truncate>
                      {notification.prTitle}
                    </Text>
                  ) : null}

                  <Text
                    fontSize="xs"
                    color="fg.subtle"
                    mt={1.5}
                    title={formatDateTime(notification.createdAt)}
                  >
                    {relativeTime(notification.createdAt)}
                    {notification.actor ? ` · ${notification.actor}` : ''}
                    {` · via ${notification.source}`}
                  </Text>
                </Box>

                <HStack gap={1} flexShrink={0} alignSelf={{ base: 'flex-end', sm: 'center' }}>
                  <IconButton
                    aria-label="Open in browser"
                    title="Open in browser"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleOpen(notification)}
                  >
                    <Icon as={LuExternalLink} />
                  </IconButton>
                  {!notification.isRead ? (
                    <IconButton
                      aria-label="Mark as read"
                      title="Mark as read"
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleMarkRead(notification)}
                    >
                      <Icon as={LuCheck} />
                    </IconButton>
                  ) : null}
                  <IconButton
                    aria-label="Delete"
                    title="Delete"
                    size="sm"
                    variant="ghost"
                    colorPalette="red"
                    onClick={() => void handleDelete(notification)}
                  >
                    <Icon as={LuTrash2} />
                  </IconButton>
                </HStack>
              </Flex>
            </Card>
          ))}
        </Stack>
      )}

      {pageCount > 1 ? (
        <HStack justify="center" mt={5} gap={3}>
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <Text fontSize="sm" color="fg.subtle">
            Page {page + 1} of {pageCount}
          </Text>
          <Button
            size="sm"
            variant="outline"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </HStack>
      ) : null}
    </Box>
  );
}
