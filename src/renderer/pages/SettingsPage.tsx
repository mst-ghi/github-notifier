import {
  Badge,
  Box,
  Button,
  Code,
  Flex,
  HStack,
  Heading,
  Icon,
  Input,
  NativeSelect,
  Separator,
  Stack,
  Switch,
  Tabs,
  Text,
} from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import {
  LuBell,
  LuDatabase,
  LuDownload,
  LuEraser,
  LuExternalLink,
  LuEye,
  LuEyeOff,
  LuInfo,
  LuKeyRound,
  LuRefreshCw,
  LuServer,
  LuTrash2,
  LuUserRound,
} from 'react-icons/lu';
import { relativeTime } from '../../shared/format';
import type {
  AppSettings,
  AppSettingsUpdate,
  DaemonStatus,
  UpdateDownload,
  UpdateInfo,
} from '../../shared/types';
import { Card, ErrorBanner, LoadingBlock, PageHeader } from '../components/Common';
import { useColorMode } from '../components/Provider';
import { useToast } from '../components/Toaster';
import { UpdateProgress } from '../components/UpdateProgress';
import { useAsync, useIpcEvent } from '../hooks/useIpc';
import { invoke, openExternal } from '../lib/api';

/** Human-readable file size. Kept local; nothing else needs it. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

const TOKEN_HELP_URL =
  'https://github.com/settings/tokens/new?scopes=repo,notifications&description=GitHub%20Notifier';

export interface SettingsPageProps {
  status: DaemonStatus | null;
  onReload: () => Promise<void>;
}

/** One labelled row. Stacks under `sm` so nothing overflows on a narrow window. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Flex
      direction={{ base: 'column', sm: 'row' }}
      align={{ base: 'stretch', sm: 'center' }}
      justify="space-between"
      gap={3}
      py={3}
    >
      <Box minW={0} flex="1">
        <Text fontSize="sm" fontWeight="600">
          {label}
        </Text>
        {hint ? (
          <Text fontSize="xs" color="fg.subtle" mt={0.5}>
            {hint}
          </Text>
        ) : null}
      </Box>
      <Box flexShrink={0} w={{ base: 'full', sm: 'auto' }}>
        {children}
      </Box>
    </Flex>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Card mb={4} p={{ base: 4, md: 5 }}>
      <Heading size="sm">{title}</Heading>
      {description ? (
        <Text fontSize="xs" color="fg.subtle" mt={1}>
          {description}
        </Text>
      ) : null}
      <Separator my={3} />
      <Stack gap={0} separator={<Separator />}>
        {children}
      </Stack>
    </Card>
  );
}

export function SettingsPage({ status, onReload }: SettingsPageProps): JSX.Element {
  const toast = useToast();
  const { preference, setColorMode } = useColorMode();
  const { data, loading, error, reload, setData } = useAsync(() => invoke('settings:get'), []);
  const stats = useAsync(() => invoke('notifications:stats'), []);

  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState('account');
  const [download, setDownload] = useState<UpdateDownload | null>(null);

  useEffect(() => {
    void invoke('update:state')
      .then(setDownload)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void invoke('app:version').then(setVersion);
  }, []);

  useEffect(() => {
    if (data) {
      setDraft(data);
    }
  }, [data]);

  const patch = async (update: AppSettingsUpdate): Promise<void> => {
    if (!draft) {
      return;
    }
    const optimistic = { ...draft, ...update } as AppSettings;
    setDraft(optimistic);
    try {
      const saved = await invoke('settings:update', update);
      setData(saved);
    } catch (caught) {
      setDraft(data);
      toast.error(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const handleSaveToken = async (): Promise<void> => {
    setSavingToken(true);
    try {
      const validation = await invoke('settings:setToken', token);
      setToken('');
      await reload();
      await onReload();
      const scopeNote =
        validation.missingScopes.length > 0
          ? ` (missing scopes: ${validation.missingScopes.join(', ')})`
          : '';
      toast.success(`Signed in as ${validation.user?.login ?? 'unknown'}${scopeNote}`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingToken(false);
    }
  };

  const handleClearToken = async (): Promise<void> => {
    await invoke('settings:clearToken');
    await reload();
    await onReload();
    toast.info('Token removed from the keyring');
  };

  const handlePruneNow = async (): Promise<void> => {
    const removed = await invoke('notifications:pruneNow');
    await stats.reload();
    toast.info(
      removed > 0 ? `Deleted ${removed} old notifications` : 'Nothing old enough to delete'
    );
  };

  const handleClearHistory = async (): Promise<void> => {
    const removed = await invoke('notifications:clearAll');
    await stats.reload();
    toast.info(`Deleted all ${removed} notifications`);
  };

  useIpcEvent('event:updateDownload', setDownload);

  const handleCheckUpdates = async (): Promise<void> => {
    setChecking(true);
    try {
      const result = await invoke('app:checkForUpdates');
      setUpdate(result);
      if (result.error) {
        toast.error(result.error);
      } else if (result.updateAvailable) {
        toast.success(`Version ${result.latestVersion} is available`);
      } else {
        toast.info('You are on the latest version');
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  };

  const handleGenerateSecret = async (): Promise<void> => {
    const secret = await invoke('settings:generateWebhookSecret');
    await reload();
    toast.success(`Webhook secret generated: ${secret.slice(0, 8)}… (stored in the keyring)`);
  };

  if (loading && !draft) {
    return <LoadingBlock label="Loading settings…" />;
  }
  if (!draft) {
    return <ErrorBanner message={error ?? 'Settings are unavailable.'} />;
  }

  return (
    <Box maxW="860px">
      <PageHeader
        title="Settings"
        description="Everything the app lets you change, grouped by what you came here to do."
        actions={
          <Button size="sm" variant="outline" onClick={() => void invoke('daemon:pollNow')}>
            <Icon as={LuRefreshCw} />
            Check now
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <Tabs.Root
        value={tab}
        onValueChange={(details) => setTab(details.value)}
        variant="line"
        lazyMount
        unmountOnExit={false}
      >
        {/* Scrolls rather than wraps: a wrapped tab strip reads as two rows of
            unrelated things. */}
        <Tabs.List overflowX="auto" flexWrap="nowrap">
          <Tabs.Trigger value="account">
            <Icon as={LuUserRound} boxSize={4} />
            Account
          </Tabs.Trigger>
          <Tabs.Trigger value="notifications">
            <Icon as={LuBell} boxSize={4} />
            Notifications
          </Tabs.Trigger>
          <Tabs.Trigger value="service">
            <Icon as={LuServer} boxSize={4} />
            Service
          </Tabs.Trigger>
          <Tabs.Trigger value="history">
            <Icon as={LuDatabase} boxSize={4} />
            History
          </Tabs.Trigger>
          <Tabs.Trigger value="about">
            <Icon as={LuInfo} boxSize={4} />
            About
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="account" pt={4}>
          <Section
            title="GitHub account"
            description="The token is stored in your system keyring, never in the database."
          >
            <Field
              label="Personal access token"
              hint={
                draft.hasToken
                  ? `Stored. Signed in as ${draft.userId ?? 'unknown'}.`
                  : 'Needs the "repo" and "notifications" scopes.'
              }
            >
              <HStack gap={2} w={{ base: 'full', sm: 'auto' }}>
                <Input
                  type={showToken ? 'text' : 'password'}
                  placeholder={draft.hasToken ? '•••••••••••••••• (replace)' : 'ghp_…'}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  size="sm"
                  w={{ base: 'full', sm: '260px' }}
                  fontFamily="mono"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowToken((current) => !current)}
                  aria-label={showToken ? 'Hide token' : 'Show token'}
                >
                  <Icon as={showToken ? LuEyeOff : LuEye} />
                </Button>
                <Button
                  size="sm"
                  colorPalette="brand"
                  loading={savingToken}
                  disabled={token.trim().length === 0}
                  onClick={() => void handleSaveToken()}
                >
                  Save
                </Button>
              </HStack>
            </Field>

            <Field label="Create a token" hint="Opens GitHub with the right scopes pre-selected.">
              <HStack gap={2}>
                <Button size="sm" variant="outline" onClick={() => openExternal(TOKEN_HELP_URL)}>
                  <Icon as={LuKeyRound} />
                  Open GitHub
                  <Icon as={LuExternalLink} boxSize={3} />
                </Button>
                {draft.hasToken ? (
                  <Button
                    size="sm"
                    variant="outline"
                    colorPalette="red"
                    onClick={() => void handleClearToken()}
                  >
                    Remove token
                  </Button>
                ) : null}
              </HStack>
            </Field>
          </Section>
        </Tabs.Content>
        <Tabs.Content value="notifications" pt={4}>
          <Section title="Notifications">
            <Field label="Desktop notifications" hint="History is still recorded when this is off.">
              <Switch.Root
                checked={draft.notificationsEnabled}
                onCheckedChange={(details) => void patch({ notificationsEnabled: details.checked })}
                colorPalette="brand"
              >
                <Switch.HiddenInput />
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </Field>

            <Field label="Sound" hint="Plays the desktop message sound with each toast.">
              <Switch.Root
                checked={draft.soundEnabled}
                onCheckedChange={(details) => void patch({ soundEnabled: details.checked })}
                colorPalette="brand"
              >
                <Switch.HiddenInput />
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </Field>

            <Field label="Start minimised" hint="Open straight to the tray on launch.">
              <Switch.Root
                checked={draft.startMinimized}
                onCheckedChange={(details) => void patch({ startMinimized: details.checked })}
                colorPalette="brand"
              >
                <Switch.HiddenInput />
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </Field>
          </Section>

          <Section title="Polling" description="How often the app asks GitHub for news.">
            <Field label="Notification poll" hint="Seconds between checks. Minimum 30.">
              <Input
                type="number"
                size="sm"
                w={{ base: 'full', sm: '120px' }}
                min={30}
                value={draft.pollIntervalSeconds}
                onChange={(event) =>
                  setDraft({ ...draft, pollIntervalSeconds: Number(event.target.value) })
                }
                onBlur={(event) => void patch({ pollIntervalSeconds: Number(event.target.value) })}
              />
            </Field>

            <Field
              label="Conflict scan"
              hint="Seconds between merge-conflict scans. This one costs several API calls per repository, so keep it high."
            >
              <Input
                type="number"
                size="sm"
                w={{ base: 'full', sm: '120px' }}
                min={300}
                value={draft.conflictPollIntervalSeconds}
                onChange={(event) =>
                  setDraft({ ...draft, conflictPollIntervalSeconds: Number(event.target.value) })
                }
                onBlur={(event) =>
                  void patch({ conflictPollIntervalSeconds: Number(event.target.value) })
                }
              />
            </Field>

            <Field
              label="Conflict grace period"
              hint="Hours a pull request must be open before conflicts are reported."
            >
              <Input
                type="number"
                size="sm"
                w={{ base: 'full', sm: '120px' }}
                min={0}
                value={draft.conflictGraceHours}
                onChange={(event) =>
                  setDraft({ ...draft, conflictGraceHours: Number(event.target.value) })
                }
                onBlur={(event) => void patch({ conflictGraceHours: Number(event.target.value) })}
              />
            </Field>

            <Field label="Only my pull requests" hint="Ignore activity on other people's PRs.">
              <Switch.Root
                checked={draft.onlyMyPullRequests}
                onCheckedChange={(details) => void patch({ onlyMyPullRequests: details.checked })}
                colorPalette="brand"
              >
                <Switch.HiddenInput />
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </Field>
          </Section>
        </Tabs.Content>
        <Tabs.Content value="service" pt={4}>
          <Section title="Background service" description="Runs independently of this window.">
            <Field label="Status">
              <Badge colorPalette={status?.reachable ? 'green' : 'red'}>
                {status?.reachable ? 'running' : 'not running'}
              </Badge>
            </Field>
            <Field label="Start it" hint="Runs as a user service, so it starts when you log in.">
              <Code fontSize="xs" px={2} py={1}>
                systemctl --user enable --now github-notifier
              </Code>
            </Field>
            <Field label="Last poll">
              <Text fontSize="sm" color="fg.subtle">
                {status?.lastPollAt ? new Date(status.lastPollAt).toLocaleString() : 'never'}
              </Text>
            </Field>
          </Section>

          <Section
            title="Webhook receiver"
            description="Optional. GitHub can only reach this port through a tunnel or a public address; without one, polling covers everything."
          >
            <Field label="Listen port" hint="The daemon binds this port for incoming deliveries.">
              <Input
                type="number"
                size="sm"
                w={{ base: 'full', sm: '120px' }}
                value={draft.webhookPort}
                min={1}
                max={65535}
                onChange={(event) =>
                  setDraft({ ...draft, webhookPort: Number(event.target.value) })
                }
                onBlur={(event) => void patch({ webhookPort: Number(event.target.value) })}
              />
            </Field>

            <Field
              label="Public URL"
              hint="e.g. https://gh.example.com — the app appends /webhook when registering hooks."
            >
              <Input
                size="sm"
                w={{ base: 'full', sm: '280px' }}
                placeholder="https://…"
                value={draft.publicWebhookUrl ?? ''}
                onChange={(event) => setDraft({ ...draft, publicWebhookUrl: event.target.value })}
                onBlur={(event) =>
                  void patch({ publicWebhookUrl: event.target.value.trim() || null })
                }
              />
            </Field>

            <Field
              label="Shared secret"
              hint="Used to verify the X-Hub-Signature-256 header on every delivery."
            >
              <HStack gap={2}>
                <Badge colorPalette={draft.hasWebhookSecret ? 'green' : 'gray'}>
                  {draft.hasWebhookSecret ? 'stored' : 'not set'}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => void handleGenerateSecret()}>
                  Generate new
                </Button>
              </HStack>
            </Field>

            <Field label="Receiver status" hint="Reported by the background service.">
              <Text fontSize="sm" color="fg.subtle">
                {status?.webhookListening
                  ? `listening on ${status.webhookPort}`
                  : 'not listening (polling only)'}
              </Text>
            </Field>
          </Section>
        </Tabs.Content>
        <Tabs.Content value="history" pt={4}>
          <Section
            title="History"
            description="Notifications live in a local SQLite file. Nothing leaves your machine."
          >
            <Field
              label="Keep notifications for"
              hint="Anything older is deleted automatically, read or not. 0 keeps everything forever."
            >
              <HStack gap={2}>
                <Input
                  type="number"
                  size="sm"
                  w={{ base: 'full', sm: '110px' }}
                  min={0}
                  value={draft.retentionDays}
                  onChange={(event) =>
                    setDraft({ ...draft, retentionDays: Number(event.target.value) })
                  }
                  onBlur={(event) => void patch({ retentionDays: Number(event.target.value) })}
                />
                <Text fontSize="sm" color="fg.subtle">
                  days
                </Text>
              </HStack>
            </Field>

            <Field
              label="Delete old now"
              hint={
                stats.data
                  ? `${stats.data.prunable} of ${stats.data.total} notifications are past the limit.`
                  : 'Runs the same clean-up the app performs hourly.'
              }
            >
              <Button
                size="sm"
                variant="outline"
                disabled={(stats.data?.prunable ?? 0) === 0}
                onClick={() => void handlePruneNow()}
              >
                <Icon as={LuEraser} />
                Delete old
              </Button>
            </Field>

            <Field label="Delete everything" hint="Removes the whole history. Cannot be undone.">
              <Button
                size="sm"
                variant="outline"
                colorPalette="red"
                disabled={(stats.data?.total ?? 0) === 0}
                onClick={() => void handleClearHistory()}
              >
                <Icon as={LuTrash2} />
                Clear history
              </Button>
            </Field>

            <Field label="Stored" hint="Row count, file size and how far back the history goes.">
              <HStack gap={2} color="fg.subtle" fontSize="sm">
                <Icon as={LuDatabase} boxSize={4} />
                <Text>
                  {stats.data
                    ? `${stats.data.total} rows · ${formatBytes(stats.data.databaseBytes)}${
                        stats.data.oldestAt ? ` · since ${relativeTime(stats.data.oldestAt)}` : ''
                      }`
                    : '—'}
                </Text>
              </HStack>
            </Field>
          </Section>
        </Tabs.Content>
        <Tabs.Content value="about" pt={4}>
          <Section title="Appearance">
            <Field label="Colour mode" hint="System follows your desktop theme.">
              <NativeSelect.Root size="sm" width={{ base: 'full', sm: '160px' }}>
                <NativeSelect.Field
                  value={preference}
                  onChange={(event) => {
                    const value = event.currentTarget.value as 'light' | 'dark' | 'system';
                    setColorMode(value);
                    void patch({ theme: value });
                  }}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field>
          </Section>

          <Section
            title="Updates"
            description="Releases are published on GitHub. The app checks, but never installs by itself."
          >
            <Field label="Installed version">
              <HStack gap={2}>
                <Badge variant="outline">v{version || '—'}</Badge>
                {update?.updateAvailable ? (
                  <Badge colorPalette="green">v{update.latestVersion} available</Badge>
                ) : null}
              </HStack>
            </Field>

            <Field
              label="Check for updates"
              hint={
                update?.publishedAt
                  ? `Latest release published ${relativeTime(update.publishedAt)}.`
                  : 'Asks the GitHub Releases API for the newest tag.'
              }
            >
              <HStack gap={2}>
                <Button
                  size="sm"
                  variant="outline"
                  loading={checking}
                  onClick={() => void handleCheckUpdates()}
                >
                  <Icon as={LuRefreshCw} />
                  Check now
                </Button>
                {update?.releaseUrl ? (
                  <Button
                    size="sm"
                    colorPalette={update.updateAvailable ? 'brand' : 'gray'}
                    variant={update.updateAvailable ? 'solid' : 'outline'}
                    onClick={() => openExternal(update.downloadUrl ?? update.releaseUrl ?? '')}
                  >
                    <Icon as={LuDownload} />
                    {update.downloadUrl ? 'Download .deb' : 'Open release'}
                  </Button>
                ) : null}
              </HStack>
            </Field>

            {download ? (
              <UpdateProgress
                state={download}
                onCopyCommand={(command) => {
                  void invoke('app:copyToClipboard', command);
                  toast.success('Command copied');
                }}
              />
            ) : null}

            <Field label="All releases" hint="Every published build, with its .deb and AppImage.">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openExternal('https://github.com/mst-ghi/github-notifier/releases')}
              >
                <Icon as={LuExternalLink} />
                Open on GitHub
              </Button>
            </Field>
          </Section>
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}
