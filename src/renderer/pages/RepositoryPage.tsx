import { Badge, Box, Button, Flex, HStack, Icon, Separator, Stack, Text } from '@chakra-ui/react';
import { useCallback, useState } from 'react';
import {
  LuArrowLeft,
  LuExternalLink,
  LuGitBranch,
  LuLock,
  LuRefreshCw,
  LuWebhook,
} from 'react-icons/lu';
import { useNavigate, useParams } from 'react-router-dom';
import { relativeTime } from '../../shared/format';
import type { PullRequestDetail, PullRequestSummary } from '../../shared/types';
import { Card, EmptyState, ErrorBanner, LoadingBlock } from '../components/Common';
import { PullRequestDrawer } from '../components/PullRequestDrawer';
import { PullRequestRow } from '../components/PullRequestRow';
import { useAsync } from '../hooks/useIpc';
import { invoke, openExternal } from '../lib/api';

/**
 * One repository: its metadata, and every open pull request.
 *
 * Pull requests come straight from GitHub rather than the local database. They
 * change constantly and are only interesting while the page is open, so caching
 * them would mean showing stale titles for no benefit.
 */
export function RepositoryPage(): JSX.Element {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();

  const repo = useAsync(() => invoke('repos:get', repoId), [repoId]);
  const pulls = useAsync(() => invoke('pulls:list', repoId), [repoId]);

  const [selected, setSelected] = useState<PullRequestSummary | null>(null);
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const handleSelect = useCallback(
    (pull: PullRequestSummary) => {
      // Show the row's data at once and fill in the rest when it arrives.
      setSelected(pull);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);

      void invoke('pulls:get', repoId, pull.number)
        .then((full) => {
          // Ignore a response that lost the race to a newer click.
          setSelected((current) => {
            if (current?.number === pull.number) {
              setDetail(full);
            }
            return current;
          });
        })
        .catch((error: unknown) => {
          setDetailError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => setDetailLoading(false));
    },
    [repoId]
  );

  if (repo.loading && !repo.data) {
    return <LoadingBlock label="Loading repository…" />;
  }
  if (!repo.data) {
    return <ErrorBanner message={repo.error ?? 'That repository is not in the database.'} />;
  }

  const info = repo.data;
  const items = pulls.data ?? [];
  const mine = items.filter((pull) => pull.isMine).length;

  return (
    <Box>
      <Button size="xs" variant="ghost" mb={3} onClick={() => navigate('/')}>
        <Icon as={LuArrowLeft} />
        All repositories
      </Button>

      <Card p={{ base: 4, md: 5 }} mb={4}>
        <Flex
          direction={{ base: 'column', md: 'row' }}
          justify="space-between"
          gap={3}
          align={{ base: 'stretch', md: 'flex-start' }}
        >
          <Box minW={0}>
            <HStack gap={2} flexWrap="wrap" mb={1}>
              <Text fontSize={{ base: 'md', md: 'lg' }} fontWeight="700" fontFamily="mono">
                {info.fullName}
              </Text>
              {info.private ? (
                <Box as="span" title="Private repository" display="inline-flex">
                  <Icon as={LuLock} boxSize={3.5} color="fg.subtle" />
                </Box>
              ) : null}
              {info.monitoring ? (
                <Badge colorPalette="green" size="sm">
                  watching
                </Badge>
              ) : (
                <Badge size="sm">not watched</Badge>
              )}
              {info.webhookStatus === 'active' ? (
                <Badge size="sm" colorPalette="blue">
                  <Icon as={LuWebhook} boxSize={3} mr={1} />
                  webhook
                </Badge>
              ) : null}
            </HStack>

            <Text fontSize="sm" color="fg.subtle">
              {info.description ?? 'No description.'}
            </Text>

            <HStack gap={4} mt={2} flexWrap="wrap" fontSize="xs" color="fg.subtle">
              <HStack gap={1}>
                <Icon as={LuGitBranch} boxSize={3} />
                <Text fontFamily="mono">{info.defaultBranch}</Text>
              </HStack>
              <Text>permission: {info.permission}</Text>
              {info.lastEventAt ? <Text>last event {relativeTime(info.lastEventAt)}</Text> : null}
            </HStack>
          </Box>

          <HStack gap={2} flexShrink={0}>
            <Button size="sm" variant="outline" onClick={() => openExternal(info.htmlUrl)}>
              <Icon as={LuExternalLink} />
              GitHub
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={pulls.loading}
              onClick={() => void pulls.reload()}
            >
              <Icon as={LuRefreshCw} />
              Refresh
            </Button>
          </HStack>
        </Flex>
      </Card>

      <Flex align="center" justify="space-between" gap={3} mb={2} flexWrap="wrap">
        <HStack gap={2}>
          <Text fontSize="sm" fontWeight="700">
            Open pull requests
          </Text>
          <Badge colorPalette={items.length > 0 ? 'brand' : 'gray'} borderRadius="full">
            {items.length}
          </Badge>
          {mine > 0 ? (
            <Text fontSize="xs" color="fg.subtle">
              {mine} yours
            </Text>
          ) : null}
        </HStack>
        <Button size="xs" variant="ghost" onClick={() => openExternal(`${info.htmlUrl}/pulls`)}>
          Open the list on GitHub
          <Icon as={LuExternalLink} boxSize={3} />
        </Button>
      </Flex>

      {pulls.error ? <ErrorBanner message={pulls.error} /> : null}

      {pulls.loading && items.length === 0 ? (
        <LoadingBlock label="Asking GitHub for open pull requests…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No open pull requests"
          description={`Nothing is waiting in ${info.fullName} right now.`}
        />
      ) : (
        <Card overflow="hidden">
          <Stack gap={0} separator={<Separator />}>
            {items.map((pull) => (
              <PullRequestRow
                key={pull.id}
                pull={pull}
                selected={selected?.number === pull.number}
                onSelect={handleSelect}
              />
            ))}
          </Stack>
        </Card>
      )}

      <PullRequestDrawer
        summary={selected}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={() => {
          setSelected(null);
          setDetail(null);
        }}
      />
    </Box>
  );
}
