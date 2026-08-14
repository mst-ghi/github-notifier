import { Box } from '@chakra-ui/react';
import { useCallback, useEffect, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import type { DaemonStatus, OpenPullRequestCounts } from '../shared/types';
import { AppShell } from './components/AppShell';
import { useToast } from './components/Toaster';
import { SetupShell } from './components/WindowFrame';
import { useIpcEvent } from './hooks/useIpc';
import { invoke } from './lib/api';
import { NotificationsPage } from './pages/NotificationsPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ProfilePage } from './pages/ProfilePage';
import { RepositoriesPage } from './pages/RepositoriesPage';
import { RepositoryPage } from './pages/RepositoryPage';
import { SettingsPage } from './pages/SettingsPage';

/**
 * Holds the two pieces of state every page cares about — unread count and
 * daemon status — and keeps them in sync with the main process pushes.
 */
export function App(): JSX.Element {
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  // This window's own database connection, which is what decides whether the
  // user's edits can be saved. Unrelated to whether the daemon is running.
  const [dbConnected, setDbConnected] = useState(true);
  const [counts, setCounts] = useState<OpenPullRequestCounts | null>(null);
  // `null` while unknown, so the app never flashes the main UI on a first run
  // or the setup flow on an existing one.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    void invoke('settings:get')
      .then((settings) => setNeedsSetup(!settings.onboardingCompleted))
      .catch(() => setNeedsSetup(false));
  }, []);
  const navigate = useNavigate();
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const [count, daemonStatus, db] = await Promise.all([
        invoke('notifications:unreadCount'),
        invoke('daemon:status'),
        invoke('app:dbConnected'),
      ]);
      setUnread(count);
      setStatus(daemonStatus);
      setDbConnected(db);

      // Counts need a GitHub round-trip per watched repo, so they are fetched
      // separately and must never hold up the rest of the refresh.
      void invoke('pulls:counts')
        .then(setCounts)
        .catch(() => undefined);
    } catch {
      // Startup races with MongoDB are expected; the periodic push recovers.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useIpcEvent('event:unreadCount', setUnread);
  useIpcEvent('event:status', setStatus);
  useIpcEvent('event:dbConnected', setDbConnected);
  useIpcEvent('event:pullCounts', setCounts);
  useIpcEvent('event:navigate', ({ route }) => navigate(route));
  useIpcEvent('event:toast', ({ severity, message }) => toast.show(severity, message));
  useIpcEvent('event:notification', (notification) => {
    setUnread((current) => current + 1);
    toast.show(notification.severity, notification.message);
  });

  const togglePause = useCallback(async () => {
    try {
      const next = status?.paused ? await invoke('daemon:resume') : await invoke('daemon:pause');
      setStatus(next);
      toast.info(next.paused ? 'Monitoring paused' : 'Monitoring resumed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [status?.paused, toast]);

  if (needsSetup === null) {
    return <Box h="100vh" bg="bg.canvas" />;
  }

  if (needsSetup) {
    // Deliberately outside AppShell's nav: during setup there is nowhere else
    // to go, and an empty sidebar would only invite a wrong turn.
    return (
      <SetupShell status={status} onTogglePause={() => void togglePause()}>
        <OnboardingPage status={status} onDone={() => setNeedsSetup(false)} />
      </SetupShell>
    );
  }

  return (
    <AppShell
      unread={unread}
      status={status}
      openPullRequests={counts?.total ?? 0}
      onTogglePause={() => void togglePause()}
    >
      <Routes>
        <Route
          path="/"
          element={<RepositoriesPage status={status} dbConnected={dbConnected} counts={counts} />}
        />
        <Route path="/repos/:repoId" element={<RepositoryPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/notifications" element={<NotificationsPage onUnreadChange={setUnread} />} />
        <Route path="/settings" element={<SettingsPage status={status} onReload={refresh} />} />
      </Routes>
    </AppShell>
  );
}
