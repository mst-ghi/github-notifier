import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  IconButton,
  Image,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useEffect } from 'react';
import { LuExternalLink, LuGitMerge, LuGitPullRequest, LuTriangleAlert, LuX } from 'react-icons/lu';
import { formatDateTime, relativeTime } from '../../shared/format';
import type { PullRequestDetail, PullRequestSummary } from '../../shared/types';
import { openExternal } from '../lib/api';
import { LabelChip, mergeStateLabel } from './PullRequestRow';

export interface PullRequestDrawerProps {
  /** The row that was clicked. Shown immediately, before detail arrives. */
  summary: PullRequestSummary | null;
  detail: PullRequestDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <Flex gap={3} align="baseline" py={1.5}>
      <Text fontSize="xs" color="fg.subtle" minW="104px" flexShrink={0}>
        {label}
      </Text>
      <Box fontSize="sm" minW={0} wordBreak="break-word">
        {children}
      </Box>
    </Flex>
  );
}

/**
 * Detail panel for one pull request.
 *
 * The summary renders straight away and the detail fills in when it arrives, so
 * clicking a row never shows an empty panel while GitHub is being asked for the
 * description and diff size.
 */
export function PullRequestDrawer({
  summary,
  detail,
  loading,
  error,
  onClose,
}: PullRequestDrawerProps): JSX.Element | null {
  useEffect(() => {
    if (!summary) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [summary, onClose]);

  if (!summary) {
    return null;
  }

  const conflicted = detail?.mergeable === false || detail?.mergeableState === 'dirty';

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
        w={{ base: '100%', sm: '460px', lg: '540px' }}
        bg="bg.surface"
        borderLeftWidth="1px"
        borderColor="border.subtle"
        boxShadow="-14px 0 40px rgba(0, 0, 0, 0.45)"
        zIndex={31}
        as="section"
        aria-label={`Pull request #${summary.number}`}
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
            <Icon as={LuGitPullRequest} color={summary.draft ? 'fg.subtle' : 'green.500'} />
            <Text fontFamily="mono" fontSize="sm" color="fg.subtle">
              #{summary.number}
            </Text>
            {summary.draft ? <Badge size="sm">draft</Badge> : null}
            {summary.isMine ? (
              <Badge size="sm" colorPalette="brand">
                yours
              </Badge>
            ) : null}
            {loading ? <Spinner size="xs" /> : null}
          </HStack>
          <IconButton aria-label="Close details" size="sm" variant="ghost" onClick={onClose}>
            <Icon as={LuX} />
          </IconButton>
        </HStack>

        <Box flex="1" overflowY="auto" px={4} py={4}>
          <Text fontSize="md" fontWeight="700" lineHeight="1.35" mb={2}>
            {summary.title}
          </Text>

          <HStack gap={2} mb={4} flexWrap="wrap">
            {summary.authorAvatarUrl ? (
              <Image src={summary.authorAvatarUrl} alt="" boxSize="20px" borderRadius="full" />
            ) : null}
            <Text fontSize="xs" color="fg.subtle">
              {summary.authorLogin} opened {relativeTime(summary.createdAt)} · updated{' '}
              {relativeTime(summary.updatedAt)}
            </Text>
          </HStack>

          {conflicted ? (
            <HStack
              bg="orange.subtle"
              borderWidth="1px"
              borderColor="orange.emphasized"
              color="orange.fg"
              borderRadius="card"
              px={3}
              py={2}
              gap={2}
              mb={4}
            >
              <Icon as={LuTriangleAlert} boxSize={4} flexShrink={0} />
              <Text fontSize="sm">
                This pull request has conflicts with {summary.baseRef} and cannot be merged.
              </Text>
            </HStack>
          ) : null}

          {error ? (
            <Text fontSize="sm" color="red.fg" mb={4}>
              {error}
            </Text>
          ) : null}

          {summary.labels.length > 0 ? (
            <HStack gap={1.5} flexWrap="wrap" mb={4}>
              {summary.labels.map((label) => (
                <LabelChip key={label.name} label={label} />
              ))}
            </HStack>
          ) : null}

          <Box
            bg="bg.raised"
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="card"
            p={3}
            mb={4}
            minH="72px"
          >
            {detail ? (
              detail.body?.trim() ? (
                <Text fontSize="sm" whiteSpace="pre-wrap" lineHeight="1.55">
                  {detail.body}
                </Text>
              ) : (
                <Text fontSize="sm" color="fg.subtle">
                  No description.
                </Text>
              )
            ) : (
              <HStack gap={2} color="fg.subtle">
                <Spinner size="xs" />
                <Text fontSize="sm">Loading the description…</Text>
              </HStack>
            )}
          </Box>

          <Stack gap={0} divideY="1px">
            <Row label="Branches">
              <Text fontFamily="mono" fontSize="xs">
                {summary.headRef} → {summary.baseRef}
              </Text>
            </Row>

            {detail ? (
              <>
                <Row label="Mergeable">
                  <HStack gap={2}>
                    <Icon
                      as={LuGitMerge}
                      boxSize={4}
                      color={conflicted ? 'orange.500' : 'green.500'}
                    />
                    <Text>{mergeStateLabel(detail.mergeable, detail.mergeableState)}</Text>
                  </HStack>
                </Row>
                <Row label="Changes">
                  <HStack gap={3}>
                    <Text color="green.fg">+{detail.additions}</Text>
                    <Text color="red.fg">−{detail.deletions}</Text>
                    <Text color="fg.subtle">
                      in {detail.changedFiles} file{detail.changedFiles === 1 ? '' : 's'}
                    </Text>
                  </HStack>
                </Row>
                <Row label="Commits">{detail.commits}</Row>
                <Row label="Comments">
                  {detail.comments} issue · {detail.reviewComments} review
                </Row>
                <Row label="Head commit">
                  <Text fontFamily="mono" fontSize="xs">
                    {detail.headSha.slice(0, 12)}
                  </Text>
                </Row>
                {detail.milestone ? <Row label="Milestone">{detail.milestone}</Row> : null}
              </>
            ) : null}

            <Row label="Assignees">
              {summary.assignees.length > 0 ? summary.assignees.join(', ') : '—'}
            </Row>
            <Row label="Reviewers">
              {summary.requestedReviewers.length > 0
                ? summary.requestedReviewers.join(', ')
                : 'none requested'}
            </Row>
            <Row label="Opened">{formatDateTime(summary.createdAt)}</Row>
            <Row label="Last update">{formatDateTime(summary.updatedAt)}</Row>
            <Row label="Link">
              <Text
                fontSize="xs"
                fontFamily="mono"
                color="brand.fg"
                cursor="pointer"
                _hover={{ textDecoration: 'underline' }}
                onClick={() => openExternal(summary.htmlUrl)}
              >
                {summary.htmlUrl}
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
        >
          <Button size="sm" colorPalette="brand" onClick={() => openExternal(summary.htmlUrl)}>
            <Icon as={LuExternalLink} />
            Open on GitHub
          </Button>
          {detail ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openExternal(`${summary.htmlUrl}/files`)}
            >
              View diff
            </Button>
          ) : null}
        </HStack>
      </Flex>
    </>
  );
}
