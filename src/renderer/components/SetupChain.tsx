import { Box, Flex, HStack, Icon, Text } from '@chakra-ui/react';
import { LuCheck, LuFolderGit2, LuGithub, LuServer } from 'react-icons/lu';

/**
 * The setup chain.
 *
 * This is the app's actual shape — GitHub talks to a background service, and
 * the service talks to you — so it works as the progress indicator and the
 * explanation at the same time. A link only lights up once that part genuinely
 * works, which is why it is driven by live state rather than by which screen
 * the user happens to be on.
 */

export type LinkState = 'pending' | 'active' | 'done';

export interface SetupChainProps {
  states: [LinkState, LinkState, LinkState];
  onSelect?: (index: number) => void;
}

const NODES = [
  { icon: LuGithub, label: 'Account', caption: 'your GitHub' },
  { icon: LuFolderGit2, label: 'Repos', caption: 'what to watch' },
  { icon: LuServer, label: 'Service', caption: 'keeps watching' },
] as const;

function nodeColors(state: LinkState): { bg: string; border: string; fg: string } {
  switch (state) {
    case 'done':
      return { bg: 'success.subtle', border: 'success.solid', fg: 'success.solid' };
    case 'active':
      return { bg: 'brand.muted', border: 'brand.solid', fg: 'brand.fg' };
    default:
      return { bg: 'bg.raised', border: 'border.subtle', fg: 'fg.subtle' };
  }
}

export function SetupChain({ states, onSelect }: SetupChainProps): JSX.Element {
  return (
    <Flex
      align="flex-start"
      justify="center"
      gap={0}
      mb={{ base: 8, md: 10 }}
      as="ol"
      aria-label="Setup progress"
      listStyleType="none"
    >
      {NODES.map((node, index) => {
        const state = states[index] ?? 'pending';
        const colors = nodeColors(state);
        const previousDone = index > 0 && states[index - 1] === 'done';

        return (
          <Flex key={node.label} as="li" align="flex-start">
            {index > 0 ? (
              <Box
                w={{ base: '32px', sm: '56px' }}
                h="2px"
                mt="21px"
                bg={previousDone ? 'success.solid' : 'border.subtle'}
                className={previousDone ? 'chain-link chain-link--done' : 'chain-link'}
              />
            ) : null}

            <Box
              textAlign="center"
              cursor={onSelect ? 'pointer' : 'default'}
              onClick={onSelect ? () => onSelect(index) : undefined}
              w={{ base: '84px', sm: '104px' }}
            >
              <Flex
                align="center"
                justify="center"
                boxSize="44px"
                mx="auto"
                borderRadius="full"
                borderWidth="2px"
                borderColor={colors.border}
                bg={colors.bg}
                color={colors.fg}
                className={state === 'done' ? 'chain-node--done' : undefined}
                transition="background 200ms, border-color 200ms, color 200ms"
              >
                <Icon as={state === 'done' ? LuCheck : node.icon} boxSize={5} />
              </Flex>

              <Text
                mt={2}
                fontFamily="display"
                fontSize="xs"
                fontWeight="600"
                letterSpacing="0.06em"
                textTransform="uppercase"
                color={state === 'pending' ? 'fg.subtle' : 'fg.default'}
              >
                {node.label}
              </Text>
              <Text fontSize="10px" color="fg.subtle" display={{ base: 'none', sm: 'block' }}>
                {node.caption}
              </Text>
            </Box>
          </Flex>
        );
      })}
    </Flex>
  );
}

/** Small numbered eyebrow above each step title. */
export function StepEyebrow({ index, total }: { index: number; total: number }): JSX.Element {
  return (
    <HStack gap={2} mb={2} justify="center">
      <Text
        fontFamily="display"
        fontSize="xs"
        letterSpacing="0.14em"
        textTransform="uppercase"
        color="brand.fg"
      >
        Step {index} of {total}
      </Text>
    </HStack>
  );
}
