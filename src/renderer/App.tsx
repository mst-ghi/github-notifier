import { useCallback, useEffect, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import type { DaemonStatus } from '../shared/types';
import { AppShell } from './components/AppShell';
import { useToast } from './components/Toaster';
import { useIpcEvent } from './hooks/useIpc';
import { invoke } from './lib/api';
import { NotificationsPage } from './pages/NotificationsPage';
import { RepositoriesPage } from './pages/RepositoriesPage';
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

  return (
    <AppShell
      unread={unread}
      status={status}
      dbConnected={dbConnected}
      onTogglePause={() => void togglePause()}
    >
      <Routes>
        <Route path="/" element={<RepositoriesPage status={status} dbConnected={dbConnected} />} />
        <Route path="/notifications" element={<NotificationsPage onUnreadChange={setUnread} />} />
        <Route path="/settings" element={<SettingsPage status={status} onReload={refresh} />} />
      </Routes>
    </AppShell>
  );
}
