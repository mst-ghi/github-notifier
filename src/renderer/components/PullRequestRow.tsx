import { Badge, Box, Flex, HStack, Icon, Image, Text } from '@chakra-ui/react';
import { LuGitPullRequest, LuGitPullRequestDraft, LuMessageSquare } from 'react-icons/lu';
import { relativeTime } from '../../shared/format';
import type { PullRequestLabel, PullRequestSummary } from '../../shared/types';

/**
 * A GitHub label, in its own colour.
 *
 * GitHub only gives the background, so the text colour is derived from its
 * luminance — otherwise a pale yellow label renders white-on-white.
 */
export function LabelChip({ label }: { label: PullRequestLabel }): JSX.Element {
  const background = `#${label.color}`;
  return (
    <Box
      px={2}
      py={0.5}
      borderRadius="full"
      bg={background}
      color={readableTextColor(label.color)}
      fontSize="10px"
      fontWeight="600"
      lineHeight="1.6"
      whiteSpace="nowrap"
    >
      {label.name}
    </Box>
  );
}

/** Relative luminance, per WCAG, to pick black or white text. */
function readableTextColor(hex: string): string {
  const value = hex.length === 6 ? hex : '888888';
  const channels = [0, 2, 4].map((offset) => {
    const part = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? '#1a1a1a' : '#ffffff';
}

/** Plain-English version of GitHub's `mergeable` / `mergeable_state` pair. */
export function mergeStateLabel(mergeable: boolean | null, state: string): string {
  if (mergeable === null) {
    return 'GitHub is still checking';
  }
  switch (state) {
    case 'dirty':
      return 'conflicts with the base branch';
    case 'blocked':
      return 'blocked by a required check or review';
    case 'behind':
      return 'behind the base branch';
    case 'unstable':
      return 'mergeable, but a check is failing';
    case 'draft':
      return 'draft, so it cannot be merged yet';
    case 'clean':
      return 'ready to merge';
    default:
      return mergeable ? 'mergeable' : 'not mergeable';
  }
}

export interface PullRequestRowProps {
  pull: PullRequestSummary;
  selected: boolean;
  onSelect: (pull: PullRequestSummary) => void;
}

export function PullRequestRow({ pull, selected, onSelect }: PullRequestRowProps): JSX.Element {
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
        <HStack gap={2} flexWrap="wrap" mb={0.5}>
          <Text fontSize="sm" fontWeight="600" lineHeight="1.35">
            {pull.title}
          </Text>
          {pull.isMine ? (
            <Badge size="sm" colorPalette="brand" variant="subtle">
              yours
            </Badge>
          ) : null}
        </HStack>

        <HStack gap={2} flexWrap="wrap" mb={pull.labels.length > 0 ? 1.5 : 0}>
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
            #{pull.number}
          </Text>
          <Text fontSize="xs" color="fg.subtle">
            by {pull.authorLogin} · updated {relativeTime(pull.updatedAt)}
          </Text>
          {pull.requestedReviewers.length > 0 ? (
            <HStack gap={1} color="fg.subtle">
              <Icon as={LuMessageSquare} boxSize={3} />
              <Text fontSize="xs">{pull.requestedReviewers.length} review requested</Text>
            </HStack>
          ) : null}
        </HStack>

        {pull.labels.length > 0 ? (
          <HStack gap={1.5} flexWrap="wrap">
            {pull.labels.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </HStack>
        ) : null}
      </Box>

      {pull.authorAvatarUrl ? (
        <Image
          src={pull.authorAvatarUrl}
          alt=""
          boxSize="24px"
          borderRadius="full"
          flexShrink={0}
        />
      ) : null}
    </Flex>
  );
}
