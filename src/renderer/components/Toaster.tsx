import { Box, HStack, Icon, Stack, Text } from '@chakra-ui/react';
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { LuCircleAlert, LuCircleCheck, LuInfo, LuTriangleAlert } from 'react-icons/lu';
import type { NotificationSeverity } from '../../shared/types';

/**
 * Small self-contained toast stack.
 *
 * Chakra v3 ships a toaster, but it needs a portal set up per app; this covers
 * everything the app actually needs (a message, a colour, auto-dismiss) in far
 * less code.
 */

interface Toast {
  id: number;
  severity: NotificationSeverity;
  message: string;
}

interface ToastApi {
  show: (severity: NotificationSeverity, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ACCENT: Record<NotificationSeverity, string> = {
  info: 'blue.500',
  success: 'green.500',
  warning: 'orange.500',
  error: 'red.500',
};

const ICON: Record<NotificationSeverity, typeof LuInfo> = {
  info: LuInfo,
  success: LuCircleCheck,
  warning: LuTriangleAlert,
  error: LuCircleAlert,
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((severity: NotificationSeverity, message: string) => {
    const id = nextId++;
    setToasts((current) => [...current, { id, severity, message }]);
    const lifetimeMs = severity === 'error' ? 8000 : 4000;
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, lifetimeMs);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show('success', message),
      error: (message: string) => show('error', message),
      info: (message: string) => show('info', message),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Stack
        position="fixed"
        bottom={{ base: 3, md: 5 }}
        right={{ base: 3, md: 5 }}
        left={{ base: 3, md: 'auto' }}
        zIndex={2000}
        gap={2}
        maxW={{ base: 'auto', md: '380px' }}
        pointerEvents="none"
      >
        {toasts.map((toast) => {
          const ToastIcon = ICON[toast.severity];
          return (
            <HStack
              key={toast.id}
              bg="bg.raised"
              borderWidth="1px"
              borderColor="border.subtle"
              borderLeftWidth="4px"
              borderLeftColor={ACCENT[toast.severity]}
              borderRadius="card"
              boxShadow="lg"
              px={4}
              py={3}
              gap={3}
              align="flex-start"
              pointerEvents="auto"
            >
              <Icon as={ToastIcon} color={ACCENT[toast.severity]} boxSize={5} mt="2px" />
              <Text fontSize="sm" lineHeight="1.4">
                {toast.message}
              </Text>
            </HStack>
          );
        })}
      </Stack>
      <Box />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}
