import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react';
import { useMemo, useState } from 'react';
import {
  LuChevronDown,
  LuChevronRight,
  LuExternalLink,
  LuLock,
  LuRefreshCw,
  LuWebhook,
} from 'react-icons/lu';
import { relativeTime } from '../../shared/format';
import type { DaemonStatus, Repo, RepoEventFilters } from '../../shared/types';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  WarningBanner,
} from '../components/Common';
import { useToast } from '../components/Toaster';
import { useAsync, useDebounced } from '../hooks/useIpc';
import { invoke, openExternal } from '../lib/api';

const FILTER_LABELS: Array<{ key: keyof RepoEventFilters; label: string; hint: string }> = [
  { key: 'comments', label: 'Comments', hint: 'Issue and review comments on pull requests' },
  { key: 'reviews', label: 'Reviews', hint: 'Approvals and change requests' },
  { key: 'merges', label: 'Merges', hint: 'Pull request merged or closed' },
  { key: 'conflicts', label: 'Conflicts', hint: 'Detected by polling; no webhook exists for this' },
  { key: 'checks', label: 'CI checks', hint: 'Check suite passed or failed' },
  { key: 'assignments', label: 'Assignments', hint: 'Assigned to you or your review requested' },
];

export interface RepositoriesPageProps {
  status: DaemonStatus | null;
  /** This window's own MongoDB connection, not the daemon's. */
  dbConnected: boolean;
}

export function RepositoriesPage({ status, dbConnected }: RepositoriesPageProps): JSX.Element {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search, 200);

  const { data, loading, error, reload, setData } = useAsync(() => invoke('repos:list'), []);
  const repos = useMemo(() => data ?? [], [data]);

  const visible = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    if (!needle) {
      return repos;
    }
    return repos.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(needle) ||
        (repo.description ?? '').toLowerCase().includes(needle)
    );
  }, [repos, debouncedSearch]);

  const monitoredCount = repos.filter((repo) => repo.monitoring).length;

  const replaceRepo = (updated: Repo): void => {
    setData(repos.map((repo) => (repo.id === updated.id ? updated : repo)));
  };

  const handleSync = async (): Promise<void> => {
    setSyncing(true);
    try {
      const fresh = await invoke('repos:sync');
      setData(fresh);
      toast.success(`Synced ${fresh.length} repositories from GitHub`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSyncing(false);
    }
  };

  const handleToggle = async (repo: Repo, enabled: boolean): Promise<void> => {
    // Optimistic: the switch should feel instant even if Mongo is slow.
    replaceRepo({ ...repo, monitoring: enabled });
    try {
      const updated = await invoke('repos:setMonitoring', repo.id, enabled);
      replaceRepo(updated);
    } catch (caught) {
      replaceRepo(repo);
      toast.error(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const handleFilter = async (
    repo: Repo,
    key: keyof RepoEventFilters,
    value: boolean
  ): Promise<void> => {
    const optimistic: Repo = {
      ...repo,
      eventFilters: { ...repo.eventFilters, [key]: value },
    };
    replaceRepo(optimistic);
    try {
      const updated = await invoke('repos:update', repo.id, { eventFilters: { [key]: value } });
      replaceRepo(updated);
    } catch (caught) {
      replaceRepo(repo);
      toast.error(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const handleWebhook = async (repo: Repo): Promise<void> => {
    try {
      const updated =
        repo.webhookId === null
          ? await invoke('repos:installWebhook', repo.id)
          : await invoke('repos:removeWebhook', repo.id);
      replaceRepo(updated);
      toast.success(repo.webhookId === null ? 'Webhook installed' : 'Webhook removed');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (loading && repos.length === 0) {
    return <LoadingBlock label="Loading repositories…" />;
  }

  return (
    <Box>
      <PageHeader
        title="Repositories"
        description={`${monitoredCount} of ${repos.length} repositories are being watched`}
        actions={
          <Button
            onClick={() => void handleSync()}
            loading={syncing}
            colorPalette="brand"
            size="sm"
          >
            <Icon as={LuRefreshCw} />
            Sync from GitHub
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {!dbConnected ? (
        <ErrorBanner message="MongoDB is not reachable, so changes cannot be saved. Check that mongod is running on localhost:27017." />
      ) : null}

      {dbConnected && status && !status.reachable ? (
        <WarningBanner message="The background service is not running, so no new notifications will arrive. Your settings still save. Start it with: systemctl --user enable --now github-notifier" />
      ) : null}

      <Input
        placeholder="Filter repositories…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        mb={4}
        size="sm"
        maxW={{ base: 'full', md: '380px' }}
      />

      {visible.length === 0 ? (
        <EmptyState
          title={repos.length === 0 ? 'No repositories yet' : 'Nothing matches that filter'}
          description={
            repos.length === 0
              ? 'Add a GitHub token in Settings, then sync your repository list.'
              : undefined
          }
          action={
            repos.length === 0 ? (
              <Button size="sm" onClick={() => void handleSync()} loading={syncing}>
                Sync from GitHub
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Stack gap={2}>
          {visible.map((repo) => {
            const isOpen = expanded === repo.id;
            return (
              <Card key={repo.id}>
                <Flex
                  align={{ base: 'flex-start', md: 'center' }}
                  direction={{ base: 'column', md: 'row' }}
                  gap={3}
                  px={4}
                  py={3}
                >
                  <Box flex="1" minW={0}>
                    <HStack gap={2} flexWrap="wrap">
                      <Text
                        fontWeight="600"
                        fontSize="sm"
                        cursor="pointer"
                        _hover={{ color: 'brand.fg', textDecoration: 'underline' }}
                        onClick={() => openExternal(repo.htmlUrl)}
                      >
                        {repo.fullName}
                      </Text>
                      {repo.private ? (
                        <Box as="span" title="Private repository" display="inline-flex">
                          <Icon as={LuLock} boxSize={3} color="fg.subtle" />
                        </Box>
                      ) : null}
                      {repo.archived ? (
                        <Badge size="sm" colorPalette="gray">
                          archived
                        </Badge>
                      ) : null}
                      {repo.webhookStatus === 'active' ? (
                        <Badge size="sm" colorPalette="green">
                          webhook
                        </Badge>
                      ) : null}
                    </HStack>
                    <Text fontSize="xs" color="fg.subtle" truncate mt={0.5}>
                      {repo.description ?? 'No description'}
                    </Text>
                    {repo.lastEventAt ? (
                      <Text fontSize="xs" color="fg.subtle" mt={1}>
                        Last event {relativeTime(repo.lastEventAt)}
                      </Text>
                    ) : null}
                  </Box>

                  <HStack gap={2} flexShrink={0} alignSelf={{ base: 'flex-end', md: 'center' }}>
                    <IconButton
                      aria-label="Open on GitHub"
                      title="Open on GitHub"
                      size="sm"
                      variant="ghost"
                      onClick={() => openExternal(repo.htmlUrl)}
                    >
                      <Icon as={LuExternalLink} />
                    </IconButton>
                    <IconButton
                      aria-label={repo.webhookId === null ? 'Install webhook' : 'Remove webhook'}
                      title={
                        repo.permission !== 'admin'
                          ? 'Admin permission is required to manage webhooks'
                          : repo.webhookId === null
                            ? 'Install webhook'
                            : 'Remove webhook'
                      }
                      size="sm"
                      variant="ghost"
                      disabled={repo.permission !== 'admin'}
                      colorPalette={repo.webhookId === null ? 'gray' : 'green'}
                      onClick={() => void handleWebhook(repo)}
                    >
                      <Icon as={LuWebhook} />
                    </IconButton>
                    <IconButton
                      aria-label={isOpen ? 'Hide event filters' : 'Show event filters'}
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(isOpen ? null : repo.id)}
                    >
                      <Icon as={isOpen ? LuChevronDown : LuChevronRight} />
                    </IconButton>
                    <Switch.Root
                      checked={repo.monitoring}
                      onCheckedChange={(details) => void handleToggle(repo, details.checked)}
                      colorPalette="brand"
                      size="md"
                    >
                      <Switch.HiddenInput />
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch.Root>
                  </HStack>
                </Flex>

                {isOpen ? (
                  <Box
                    px={4}
                    py={3}
                    borderTopWidth="1px"
                    borderColor="border.subtle"
                    bg="bg.raised"
                  >
                    <Text fontSize="xs" color="fg.subtle" mb={3}>
                      Choose which events raise a notification for {repo.name}.
                    </Text>
                    <Stack
                      direction="row"
                      flexWrap="wrap"
                      gap={{ base: 3, md: 5 }}
                      opacity={repo.monitoring ? 1 : 0.5}
                    >
                      {FILTER_LABELS.map((filter) => (
                        <Switch.Root
                          key={filter.key}
                          checked={repo.eventFilters[filter.key]}
                          disabled={!repo.monitoring}
                          onCheckedChange={(details) =>
                            void handleFilter(repo, filter.key, details.checked)
                          }
                          colorPalette="brand"
                          size="sm"
                        >
                          <Switch.HiddenInput />
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                          <Switch.Label fontSize="sm" title={filter.hint}>
                            {filter.label}
                          </Switch.Label>
                        </Switch.Root>
                      ))}
                    </Stack>
                  </Box>
                ) : null}
              </Card>
            );
          })}
        </Stack>
      )}

      <Flex justify="flex-end" mt={4}>
        <Button size="xs" variant="ghost" onClick={() => void reload()}>
          Refresh list
        </Button>
      </Flex>
    </Box>
  );
}
