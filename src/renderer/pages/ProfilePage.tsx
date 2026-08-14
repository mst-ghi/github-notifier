import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  Image,
  Separator,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useCallback, useState } from 'react';
import {
  LuBuilding,
  LuExternalLink,
  LuEyeOff,
  LuGitPullRequest,
  LuGitPullRequestDraft,
  LuKeyRound,
  LuLink,
  LuMapPin,
  LuMessageSquare,
  LuRefreshCw,
  LuUserCheck,
} from 'react-icons/lu';
import { relativeTime } from '../../shared/format';
import type { PullRequestDetail, SearchedPullRequest } from '../../shared/types';
import { Card, EmptyState, ErrorBanner, LoadingBlock, PageHeader } from '../components/Common';
import { PullRequestDrawer } from '../components/PullRequestDrawer';
import { LabelChip } from '../components/PullRequestRow';
import { useAsync } from '../hooks/useIpc';
import { invoke, openExternal } from '../lib/api';

/** A search hit rendered as a row. */
function SearchRow({
  pull,
  selected,
  onSelect,
}: {
  pull: SearchedPullRequest;
  selected: boolean;
  onSelect: (pull: SearchedPullRequest) => void;
}): JSX.Element {
  return (
    <Flex
      px={4}
      py={3}
      gap={3}
      align="flex-start"
      cursor="pointer"
      bg={selected ? 'brand.muted' : 'transparent'}
      _hover={{ bg: selected ? 'brand.muted' : 'bg.raised' }}
      transition="background 120ms"
      onClick={() => onSelect(pull)}
      title="Show details"
    >
      <Icon
        as={pull.draft ? LuGitPullRequestDraft : LuGitPullRequest}
        boxSize={4}
        mt="2px"
        flexShrink={0}
        color={pull.draft ? 'fg.subtle' : 'green.500'}
      />
      <Box flex="1" minW={0}>
        <Text fontSize="sm" fontWeight="600" lineHeight="1.35" mb={0.5}>
          {pull.title}
        </Text>
        <HStack gap={2} flexWrap="wrap">
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
            {pull.repoFullName} #{pull.number}
          </Text>
          <Text fontSize="xs" color="fg.subtle">
            opened {relativeTime(pull.createdAt)}
          </Text>
          {pull.comments > 0 ? (
            <HStack gap={1} color="fg.subtle">
              <Icon as={LuMessageSquare} boxSize={3} />
              <Text fontSize="xs">{pull.comments}</Text>
            </HStack>
          ) : null}
        </HStack>
        {pull.labels.length > 0 ? (
          <HStack gap={1.5} flexWrap="wrap" mt={1.5}>
            {pull.labels.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </HStack>
        ) : null}
      </Box>
    </Flex>
  );
}

function Stat({ value, label }: { value: number | string; label: string }): JSX.Element {
  return (
    <Box textAlign="center">
      <Text fontFamily="display" fontSize="lg" fontWeight="700" lineHeight="1.2">
        {value}
      </Text>
      <Text fontSize="10px" color="fg.subtle" textTransform="uppercase" letterSpacing="0.06em">
        {label}
      </Text>
    </Box>
  );
}

/**
 * Your GitHub account, and the work currently on your plate.
 *
 * The two lists come from the search API rather than the watched repositories,
 * because "what am I blocking, and what is blocking me" is not limited to the
 * repos this app happens to be monitoring.
 */
export function ProfilePage(): JSX.Element {
  const { data, loading, error, reload } = useAsync(() => invoke('profile:overview'), []);

  const [selected, setSelected] = useState<SearchedPullRequest | null>(null);
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const handleSelect = useCallback((pull: SearchedPullRequest) => {
    setSelected(pull);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    void invoke('pulls:getByRef', pull.owner, pull.repo, pull.number)
      .then((full) => {
        setSelected((current) => {
          if (current?.id === pull.id) {
            setDetail(full);
          }
          return current;
        });
      })
      .catch((caught: unknown) => {
        setDetailError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setDetailLoading(false));
  }, []);

  if (loading && !data) {
    return <LoadingBlock label="Loading your profile…" />;
  }

  const user = data?.user ?? null;
  const authored = data?.authored ?? [];
  const reviewRequested = data?.reviewRequested ?? [];
  const missingScopes = data?.scopes.length === 0;

  return (
    <Box>
      <PageHeader
        title="Profile"
        description="Your account, and the pull requests waiting on you."
        actions={
          <Button size="sm" variant="outline" loading={loading} onClick={() => void reload()}>
            <Icon as={LuRefreshCw} />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {data?.error ? <ErrorBanner message={data.error} /> : null}

      {user ? (
        <Card p={{ base: 4, md: 5 }} mb={5}>
          <Flex gap={4} direction={{ base: 'column', sm: 'row' }} align={{ sm: 'center' }}>
            <Image
              src={user.avatarUrl}
              alt=""
              boxSize={{ base: '64px', md: '76px' }}
              borderRadius="full"
              borderWidth="1px"
              borderColor="border.subtle"
              flexShrink={0}
            />

            <Box flex="1" minW={0}>
              <Heading fontFamily="display" size="md" letterSpacing="-0.01em">
                {user.name ?? user.login}
              </Heading>
              <Text fontFamily="mono" fontSize="sm" color="fg.subtle">
                @{user.login}
              </Text>
              {user.bio ? (
                <Text fontSize="sm" mt={2} lineHeight="1.5">
                  {user.bio}
                </Text>
              ) : null}

              <HStack gap={4} mt={2} flexWrap="wrap" fontSize="xs" color="fg.subtle">
                {user.company ? (
                  <HStack gap={1}>
                    <Icon as={LuBuilding} boxSize={3} />
                    <Text>{user.company}</Text>
                  </HStack>
                ) : null}
                {user.location ? (
                  <HStack gap={1}>
                    <Icon as={LuMapPin} boxSize={3} />
                    <Text>{user.location}</Text>
                  </HStack>
                ) : null}
                {user.blog ? (
                  <HStack
                    gap={1}
                    cursor="pointer"
                    _hover={{ color: 'brand.fg' }}
                    onClick={() => openExternal(user.blog ?? '')}
                  >
                    <Icon as={LuLink} boxSize={3} />
                    <Text>{user.blog}</Text>
                  </HStack>
                ) : null}
                <Text>joined {relativeTime(user.createdAt)}</Text>
              </HStack>
            </Box>

            <HStack gap={5} flexShrink={0} alignSelf={{ base: 'flex-start', sm: 'center' }}>
              <Stat value={user.publicRepos} label="repos" />
              <Stat value={user.followers} label="followers" />
              <Stat value={user.following} label="following" />
            </HStack>
          </Flex>

          <Separator my={4} />

          <Flex gap={4} flexWrap="wrap" justify="space-between" align="center">
            <HStack gap={2} flexWrap="wrap">
              <Icon as={LuKeyRound} boxSize={3.5} color="fg.subtle" />
              <Text fontSize="xs" color="fg.subtle">
                Token scopes:
              </Text>
              {missingScopes ? (
                <Badge size="sm" variant="outline">
                  fine-grained
                </Badge>
              ) : (
                data?.scopes.map((scope) => (
                  <Badge key={scope} size="sm" variant="subtle" fontFamily="mono">
                    {scope}
                  </Badge>
                ))
              )}
            </HStack>

            <HStack gap={3}>
              {data?.rateLimit ? (
                <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                  API {data.rateLimit.remaining}/{data.rateLimit.limit}
                </Text>
              ) : null}
              <Button size="xs" variant="ghost" onClick={() => openExternal(user.htmlUrl)}>
                View on GitHub
                <Icon as={LuExternalLink} boxSize={3} />
              </Button>
            </HStack>
          </Flex>
        </Card>
      ) : null}

      <Stack gap={6}>
        <Box>
          <HStack gap={2} mb={2}>
            <Icon as={LuGitPullRequest} boxSize={4} color="green.500" />
            <Text fontSize="sm" fontWeight="700">
              Your open pull requests
            </Text>
            <Badge borderRadius="full" colorPalette={authored.length > 0 ? 'brand' : 'gray'}>
              {authored.length}
            </Badge>
          </HStack>

          {authored.length === 0 ? (
            <EmptyState
              title="Nothing open"
              description="Pull requests you open will show up here, across every repository."
            />
          ) : (
            <Card overflow="hidden">
              <Stack gap={0} separator={<Separator />}>
                {authored.map((pull) => (
                  <SearchRow
                    key={pull.id}
                    pull={pull}
                    selected={selected?.id === pull.id}
                    onSelect={handleSelect}
                  />
                ))}
              </Stack>
            </Card>
          )}
        </Box>

        <Box>
          <HStack gap={2} mb={2}>
            <Icon as={LuUserCheck} boxSize={4} color="orange.400" />
            <Text fontSize="sm" fontWeight="700">
              Waiting on your review
            </Text>
            <Badge
              borderRadius="full"
              colorPalette={reviewRequested.length > 0 ? 'orange' : 'gray'}
              variant={reviewRequested.length > 0 ? 'solid' : 'subtle'}
            >
              {reviewRequested.length}
            </Badge>
          </HStack>

          {reviewRequested.length === 0 ? (
            <EmptyState
              title="Nobody is waiting on you"
              description="Pull requests that request your review will appear here."
            />
          ) : (
            <Card overflow="hidden">
              <Stack gap={0} separator={<Separator />}>
                {reviewRequested.map((pull) => (
                  <SearchRow
                    key={pull.id}
                    pull={pull}
                    selected={selected?.id === pull.id}
                    onSelect={handleSelect}
                  />
                ))}
              </Stack>
            </Card>
          )}
        </Box>
      </Stack>

      {!user && !loading ? (
        <EmptyState
          title="Not signed in"
          description="Add a GitHub token in Settings to see your profile."
          action={
            <HStack gap={2} color="fg.subtle">
              <Icon as={LuEyeOff} boxSize={4} />
              <Text fontSize="sm">No account connected</Text>
            </HStack>
          }
        />
      ) : null}

      <PullRequestDrawer
        summary={
          selected
            ? {
                id: selected.id,
                number: selected.number,
                title: selected.title,
                htmlUrl: selected.htmlUrl,
                draft: selected.draft,
                authorLogin: selected.authorLogin,
                authorAvatarUrl: selected.authorAvatarUrl,
                createdAt: selected.createdAt,
                updatedAt: selected.updatedAt,
                // Search hits carry no branch names; the detail call fills the
                // real values in a moment.
                baseRef: detail?.baseRef ?? '…',
                headRef: detail?.headRef ?? '…',
                labels: selected.labels,
                assignees: [],
                requestedReviewers: [],
                isMine: detail?.isMine ?? false,
              }
            : null
        }
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
