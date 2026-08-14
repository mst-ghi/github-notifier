import { Box, Button, Flex, HStack, Icon, Progress, Spinner, Text } from '@chakra-ui/react';
import { LuCheck, LuCircleAlert, LuDownload, LuFolderOpen, LuX } from 'react-icons/lu';
import { formatBytes } from '../../shared/format';
import type { UpdateDownload } from '../../shared/types';
import { invoke } from '../lib/api';

/** One-line summary of a download, e.g. "42.1 MB of 79.7 MB · 3.4 MB/s". */
export function describeProgress(state: UpdateDownload): string {
  const received = formatBytes(state.receivedBytes);
  if (state.totalBytes > 0) {
    const speed = state.bytesPerSecond > 0 ? ` · ${formatBytes(state.bytesPerSecond)}/s` : '';
    return `${received} of ${formatBytes(state.totalBytes)}${speed}`;
  }
  return received;
}

/**
 * Download panel for the Settings page.
 *
 * The app saves the package and stops: installing a .deb needs root, so it
 * hands over a verified file and the single command rather than asking for a
 * password or running anything itself.
 */
export function UpdateProgress({
  state,
  onCopyCommand,
}: {
  state: UpdateDownload;
  onCopyCommand: (command: string) => void;
}): JSX.Element | null {
  if (state.status === 'idle') {
    return null;
  }

  const busy = state.status === 'downloading' || state.status === 'verifying';
  const installCommand = state.filePath ? `sudo apt install "${state.filePath}"` : '';

  return (
    <Box
      bg="bg.raised"
      borderWidth="1px"
      borderColor={
        state.status === 'error'
          ? 'red.emphasized'
          : state.status === 'done'
            ? 'success.solid'
            : 'border.subtle'
      }
      borderRadius="card"
      p={4}
      mt={3}
    >
      <Flex justify="space-between" align="center" gap={3} mb={busy ? 3 : 0}>
        <HStack gap={2} minW={0}>
          {state.status === 'done' ? (
            <Icon as={LuCheck} color="success.fg" />
          ) : state.status === 'error' ? (
            <Icon as={LuCircleAlert} color="red.fg" />
          ) : state.status === 'cancelled' ? (
            <Icon as={LuX} color="fg.subtle" />
          ) : (
            <Spinner size="xs" />
          )}

          <Text fontSize="sm" fontWeight="600" truncate>
            {state.status === 'downloading' && `Downloading v${state.version}`}
            {state.status === 'verifying' && 'Checking the file is intact'}
            {state.status === 'done' && `v${state.version} is ready to install`}
            {state.status === 'cancelled' && 'Download cancelled'}
            {state.status === 'error' && 'Download failed'}
          </Text>
        </HStack>

        <HStack gap={2} flexShrink={0}>
          {busy ? (
            <>
              <Text fontFamily="mono" fontSize="sm" color="fg.subtle">
                {state.percent >= 0 ? `${state.percent}%` : ''}
              </Text>
              <Button size="xs" variant="ghost" onClick={() => void invoke('update:cancel')}>
                Cancel
              </Button>
            </>
          ) : null}

          {state.status === 'done' ? (
            <Button size="xs" variant="outline" onClick={() => void invoke('update:reveal')}>
              <Icon as={LuFolderOpen} />
              Show file
            </Button>
          ) : null}

          {state.status === 'error' || state.status === 'cancelled' ? (
            <Button size="xs" variant="outline" onClick={() => void invoke('update:download')}>
              <Icon as={LuDownload} />
              Try again
            </Button>
          ) : null}
        </HStack>
      </Flex>

      {busy ? (
        <>
          <Progress.Root
            value={state.percent >= 0 ? state.percent : null}
            size="sm"
            colorPalette="brand"
            mb={2}
          >
            <Progress.Track borderRadius="full">
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
            {describeProgress(state)}
          </Text>
        </>
      ) : null}

      {state.status === 'done' ? (
        <Box mt={3}>
          <Text fontSize="xs" color="fg.subtle" mb={2}>
            {state.checksumVerified
              ? 'The checksum matches the published one. Install it with:'
              : 'Install it with:'}
          </Text>
          <Flex
            align="center"
            justify="space-between"
            gap={2}
            bg="bg.surface"
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="md"
            px={3}
            py={2}
          >
            <Text fontFamily="mono" fontSize="xs" truncate>
              {installCommand}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              flexShrink={0}
              onClick={() => onCopyCommand(installCommand)}
            >
              Copy
            </Button>
          </Flex>
        </Box>
      ) : null}

      {state.error ? (
        <Text fontSize="xs" color="red.fg" mt={2}>
          {state.error}
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Compact indicator for the titlebar.
 *
 * Only present while a download is running, so the chrome stays quiet the rest
 * of the time. Clicking it goes to where the detail lives.
 */
export function UpdateProgressChip({
  state,
  onClick,
}: {
  state: UpdateDownload;
  onClick: () => void;
}): JSX.Element | null {
  const busy = state.status === 'downloading' || state.status === 'verifying';
  const finished = state.status === 'done';
  if (!busy && !finished) {
    return null;
  }

  return (
    <HStack
      gap={2}
      px={2}
      py={1}
      mr={1}
      borderRadius="full"
      bg={finished ? 'success.subtle' : 'bg.raised'}
      borderWidth="1px"
      borderColor={finished ? 'success.solid' : 'border.subtle'}
      cursor="pointer"
      className="window-no-drag"
      onClick={onClick}
      title={
        finished
          ? `Version ${state.version} downloaded — click to install it`
          : `Downloading v${state.version}: ${describeProgress(state)}`
      }
    >
      {finished ? (
        <Icon as={LuCheck} boxSize={3.5} color="success.fg" />
      ) : (
        <Icon as={LuDownload} boxSize={3.5} color="brand.fg" />
      )}

      {busy ? (
        <>
          {/* A bar rather than a spinner: the useful information is how far
              along it is, and a number alone reads as a random figure. */}
          <Box w="48px" h="4px" borderRadius="full" bg="border.subtle" overflow="hidden">
            <Box
              h="100%"
              w={`${Math.max(state.percent, 2)}%`}
              bg="brand.solid"
              transition="width 200ms linear"
            />
          </Box>
          <Text fontFamily="mono" fontSize="xs" color="fg.subtle" minW="32px">
            {state.percent >= 0 ? `${state.percent}%` : '…'}
          </Text>
        </>
      ) : (
        <Text fontSize="xs" fontWeight="600" color="success.fg">
          v{state.version} ready
        </Text>
      )}
    </HStack>
  );
}
