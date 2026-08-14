import {
  Badge,
  Box,
  Button,
  Code,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  Spinner,
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LuArrowRight,
  LuCheck,
  LuCopy,
  LuExternalLink,
  LuEye,
  LuEyeOff,
  LuLock,
  LuSearch,
} from 'react-icons/lu';
import type { DaemonStatus, Repo } from '../../shared/types';
import { type LinkState, SetupChain, StepEyebrow } from '../components/SetupChain';
import { useToast } from '../components/Toaster';
import { useDebounced } from '../hooks/useIpc';
import { invoke, openExternal } from '../lib/api';

const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo,notifications&description=GitHub%20Notifier';
const SERVICE_COMMAND = 'systemctl --user enable --now github-notifier';

export interface OnboardingPageProps {
  status: DaemonStatus | null;
  /** Called once setup is finished or skipped. */
  onDone: () => void;
}

/**
 * First-run setup.
 *
 * Three steps, because there are genuinely three things to do and each one
 * depends on the last: authorise, choose what to watch, and start the service
 * that does the watching. Every step reads its own completion from live state
 * rather than from a "next" click, so the flow can never claim something works
 * when it does not.
 */
export function OnboardingPage({ status, onDone }: OnboardingPageProps): JSX.Element {
  const toast = useToast();
  const [step, setStep] = useState(0);

  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [repos, setRepos] = useState<Repo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 200);

  const [finishing, setFinishing] = useState(false);

  const watched = useMemo(() => repos.filter((repo) => repo.monitoring).length, [repos]);
  const serviceRunning = status?.reachable ?? false;

  // Pick up an account that was already connected, so re-entering setup does
  // not ask for a token that is sitting in the keyring.
  useEffect(() => {
    void invoke('settings:get')
      .then((settings) => {
        if (settings.hasToken && settings.userId) {
          setSignedInAs(settings.userId);
          setStep((current) => (current === 0 ? 1 : current));
        }
      })
      .catch(() => undefined);
  }, []);

  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const existing = await invoke('repos:list');
      // A first run has an empty list; fetching it is the point of this step.
      setRepos(existing.length > 0 ? existing : await invoke('repos:sync'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingRepos(false);
    }
  }, [toast]);

  useEffect(() => {
    if (step === 1 && repos.length === 0 && !loadingRepos) {
      void loadRepos();
    }
  }, [step, repos.length, loadingRepos, loadRepos]);

  const handleConnect = async (): Promise<void> => {
    setConnecting(true);
    try {
      const result = await invoke('settings:setToken', token.trim());
      setSignedInAs(result.user?.login ?? null);
      setToken('');
      setStep(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setConnecting(false);
    }
  };

  const handleToggleRepo = async (repo: Repo, enabled: boolean): Promise<void> => {
    setRepos((current) =>
      current.map((item) => (item.id === repo.id ? { ...item, monitoring: enabled } : item))
    );
    try {
      await invoke('repos:setMonitoring', repo.id, enabled);
    } catch (error) {
      setRepos((current) =>
        current.map((item) => (item.id === repo.id ? { ...item, monitoring: !enabled } : item))
      );
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const finish = async (): Promise<void> => {
    setFinishing(true);
    try {
      await invoke('settings:update', { onboardingCompleted: true });
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setFinishing(false);
    }
  };

  const states: [LinkState, LinkState, LinkState] = [
    signedInAs ? 'done' : step === 0 ? 'active' : 'pending',
    watched > 0 ? 'done' : step === 1 ? 'active' : 'pending',
    serviceRunning ? 'done' : step === 2 ? 'active' : 'pending',
  ];

  const visibleRepos = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    const sorted = [...repos].sort((a, b) => {
      if (a.monitoring !== b.monitoring) {
        return a.monitoring ? -1 : 1;
      }
      return a.fullName.localeCompare(b.fullName);
    });
    return needle
      ? sorted.filter((repo) => repo.fullName.toLowerCase().includes(needle))
      : sorted.slice(0, 40);
  }, [repos, debouncedSearch]);

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      minH="100%"
      px={{ base: 4, md: 8 }}
      py={{ base: 8, md: 12 }}
    >
      <Box w="full" maxW="560px">
        <SetupChain states={states} onSelect={(index) => setStep(index)} />

        {step === 0 ? (
          <Box className="step-panel" textAlign="center">
            <StepEyebrow index={1} total={3} />
            <Heading fontFamily="display" size="lg" letterSpacing="-0.02em" mb={3}>
              Connect your GitHub account
            </Heading>
            <Text color="fg.subtle" fontSize="sm" mb={6} lineHeight="1.6">
              A personal access token lets the app see your pull requests. It is kept in your system
              keyring and never leaves this machine.
            </Text>

            <Stack gap={3}>
              <HStack gap={2}>
                <Input
                  type={showToken ? 'text' : 'password'}
                  placeholder="ghp_…"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && token.trim().length > 0) {
                      void handleConnect();
                    }
                  }}
                  fontFamily="mono"
                  size="lg"
                  autoFocus
                />
                <IconButton
                  aria-label={showToken ? 'Hide token' : 'Show token'}
                  variant="ghost"
                  size="lg"
                  onClick={() => setShowToken((current) => !current)}
                >
                  <Icon as={showToken ? LuEyeOff : LuEye} />
                </IconButton>
              </HStack>

              <Button
                size="lg"
                colorPalette="brand"
                loading={connecting}
                disabled={token.trim().length === 0}
                onClick={() => void handleConnect()}
              >
                Connect
                <Icon as={LuArrowRight} />
              </Button>

              <Button size="sm" variant="ghost" onClick={() => openExternal(TOKEN_URL)}>
                Create a token on GitHub
                <Icon as={LuExternalLink} boxSize={3} />
              </Button>

              <HStack gap={2} justify="center" color="fg.subtle" mt={1}>
                <Icon as={LuLock} boxSize={3} />
                <Text fontSize="xs">Needs the repo and notifications scopes</Text>
              </HStack>
            </Stack>
          </Box>
        ) : null}

        {step === 1 ? (
          <Box className="step-panel">
            <Box textAlign="center">
              <StepEyebrow index={2} total={3} />
              <Heading fontFamily="display" size="lg" letterSpacing="-0.02em" mb={3}>
                Choose what to watch
              </Heading>
              <Text color="fg.subtle" fontSize="sm" mb={5} lineHeight="1.6">
                {signedInAs ? `Signed in as ${signedInAs}. ` : ''}
                Turn on the repositories whose pull requests you care about. You can change this at
                any time.
              </Text>
            </Box>

            <HStack gap={2} mb={3}>
              <Box position="relative" flex="1">
                <Icon
                  as={LuSearch}
                  boxSize={4}
                  color="fg.subtle"
                  position="absolute"
                  left={3}
                  top="50%"
                  transform="translateY(-50%)"
                  pointerEvents="none"
                />
                <Input
                  placeholder="Search repositories"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  pl={9}
                />
              </Box>
              <Badge
                colorPalette={watched > 0 ? 'green' : 'gray'}
                variant={watched > 0 ? 'solid' : 'subtle'}
                borderRadius="full"
                px={3}
                py={2}
              >
                {watched} selected
              </Badge>
            </HStack>

            <Box
              borderWidth="1px"
              borderColor="border.subtle"
              borderRadius="card"
              bg="bg.surface"
              maxH="252px"
              overflowY="auto"
            >
              {loadingRepos ? (
                <HStack gap={3} p={6} justify="center" color="fg.subtle">
                  <Spinner size="sm" />
                  <Text fontSize="sm">Fetching your repositories…</Text>
                </HStack>
              ) : visibleRepos.length === 0 ? (
                <Text p={6} fontSize="sm" color="fg.subtle" textAlign="center">
                  No repositories match that search.
                </Text>
              ) : (
                visibleRepos.map((repo) => (
                  <Flex
                    key={repo.id}
                    align="center"
                    justify="space-between"
                    gap={3}
                    px={4}
                    py={2.5}
                    borderBottomWidth="1px"
                    borderColor="border.subtle"
                    _last={{ borderBottomWidth: 0 }}
                    _hover={{ bg: 'bg.raised' }}
                  >
                    <Box minW={0}>
                      <Text fontFamily="mono" fontSize="sm" truncate>
                        {repo.fullName}
                      </Text>
                      {repo.description ? (
                        <Text fontSize="xs" color="fg.subtle" truncate>
                          {repo.description}
                        </Text>
                      ) : null}
                    </Box>
                    <Switch.Root
                      checked={repo.monitoring}
                      onCheckedChange={(details) => void handleToggleRepo(repo, details.checked)}
                      colorPalette="brand"
                      flexShrink={0}
                    >
                      <Switch.HiddenInput />
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch.Root>
                  </Flex>
                ))
              )}
            </Box>

            <Button
              mt={5}
              w="full"
              size="lg"
              colorPalette="brand"
              disabled={watched === 0}
              onClick={() => setStep(2)}
            >
              {watched === 0 ? 'Pick at least one repository' : 'Continue'}
              {watched > 0 ? <Icon as={LuArrowRight} /> : null}
            </Button>
          </Box>
        ) : null}

        {step === 2 ? (
          <Box className="step-panel" textAlign="center">
            <StepEyebrow index={3} total={3} />
            <Heading fontFamily="display" size="lg" letterSpacing="-0.02em" mb={3}>
              Start the background service
            </Heading>
            <Text color="fg.subtle" fontSize="sm" mb={6} lineHeight="1.6">
              A small service does the watching, so notifications keep arriving after you close this
              window. Run this once and it starts with you from now on.
            </Text>

            <Flex
              align="center"
              justify="space-between"
              gap={3}
              bg="bg.surface"
              borderWidth="1px"
              borderColor="border.subtle"
              borderRadius="card"
              px={4}
              py={3}
              mb={4}
            >
              <Code
                fontFamily="mono"
                fontSize="sm"
                bg="transparent"
                p={0}
                textAlign="left"
                overflowX="auto"
              >
                {SERVICE_COMMAND}
              </Code>
              <IconButton
                aria-label="Copy the command"
                size="sm"
                variant="ghost"
                flexShrink={0}
                onClick={() => {
                  void invoke('app:copyToClipboard', SERVICE_COMMAND);
                  toast.success('Command copied');
                }}
              >
                <Icon as={LuCopy} />
              </IconButton>
            </Flex>

            <HStack
              gap={3}
              justify="center"
              bg={serviceRunning ? 'success.subtle' : 'bg.raised'}
              borderWidth="1px"
              borderColor={serviceRunning ? 'success.solid' : 'border.subtle'}
              borderRadius="card"
              px={4}
              py={3}
              mb={6}
            >
              {serviceRunning ? (
                <>
                  <Icon as={LuCheck} color="success.fg" />
                  <Text fontSize="sm" color="success.fg">
                    The service is running. You are all set.
                  </Text>
                </>
              ) : (
                <>
                  <Spinner size="xs" color="fg.subtle" />
                  <Text fontSize="sm" color="fg.subtle">
                    Waiting for the service… this updates on its own.
                  </Text>
                </>
              )}
            </HStack>

            <Button
              w="full"
              size="lg"
              colorPalette={serviceRunning ? 'brand' : 'gray'}
              variant={serviceRunning ? 'solid' : 'outline'}
              loading={finishing}
              onClick={() => void finish()}
            >
              {serviceRunning ? 'Start using GitHub Notifier' : 'Finish without the service'}
            </Button>
          </Box>
        ) : null}

        <Flex justify="center" mt={8}>
          <Button size="xs" variant="ghost" color="fg.subtle" onClick={() => void finish()}>
            Skip setup
          </Button>
        </Flex>
      </Box>
    </Flex>
  );
}
