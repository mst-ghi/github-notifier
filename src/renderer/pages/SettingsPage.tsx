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
  Text,
} from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { LuExternalLink, LuEye, LuEyeOff, LuKeyRound, LuRefreshCw } from 'react-icons/lu';
import type { AppSettings, AppSettingsUpdate, DaemonStatus } from '../../shared/types';
import { Card, ErrorBanner, LoadingBlock, PageHeader } from '../components/Common';
import { useColorMode } from '../components/Provider';
import { useToast } from '../components/Toaster';
import { useAsync } from '../hooks/useIpc';
import { invoke, openExternal } from '../lib/api';

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

  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [draft, setDraft] = useState<AppSettings | null>(null);

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
        description="Token, webhook, polling and notification behaviour."
        actions={
          <Button size="sm" variant="outline" onClick={() => void invoke('daemon:pollNow')}>
            <Icon as={LuRefreshCw} />
            Check now
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <Section
        title="GitHub account"
        description="The token is stored in your system keyring, never in MongoDB."
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
            onChange={(event) => setDraft({ ...draft, webhookPort: Number(event.target.value) })}
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
            onBlur={(event) => void patch({ publicWebhookUrl: event.target.value.trim() || null })}
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

        <Field
          label="History retention"
          hint="Days to keep read notifications. 0 keeps everything."
        >
          <Input
            type="number"
            size="sm"
            w={{ base: 'full', sm: '120px' }}
            min={0}
            value={draft.retentionDays}
            onChange={(event) => setDraft({ ...draft, retentionDays: Number(event.target.value) })}
            onBlur={(event) => void patch({ retentionDays: Number(event.target.value) })}
          />
        </Field>
      </Section>

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
    </Box>
  );
}
