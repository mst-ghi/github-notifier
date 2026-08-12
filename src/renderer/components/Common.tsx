import { Box, Center, Flex, HStack, Heading, Icon, Spinner, Stack, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { LuCircleAlert, LuInbox, LuTriangleAlert } from 'react-icons/lu';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

/** Title row that stacks on narrow windows so the buttons never get cut off. */
export function PageHeader({ title, description, actions }: PageHeaderProps): JSX.Element {
  return (
    <Flex
      direction={{ base: 'column', sm: 'row' }}
      align={{ base: 'stretch', sm: 'center' }}
      justify="space-between"
      gap={3}
      mb={5}
    >
      <Box minW={0}>
        <Heading size={{ base: 'md', md: 'lg' }}>{title}</Heading>
        {description ? (
          <Text color="fg.subtle" fontSize="sm" mt={1}>
            {description}
          </Text>
        ) : null}
      </Box>
      {actions ? (
        <HStack gap={2} flexShrink={0} flexWrap="wrap">
          {actions}
        </HStack>
      ) : null}
    </Flex>
  );
}

export function Card({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) {
  return (
    <Box
      bg="bg.surface"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="card"
      overflow="hidden"
      {...rest}
    >
      {children}
    </Box>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <Center py={16}>
      <Stack align="center" gap={3}>
        <Spinner size="lg" color="brand.solid" />
        <Text fontSize="sm" color="fg.subtle">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}

export function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <HStack
      bg="red.subtle"
      borderWidth="1px"
      borderColor="red.emphasized"
      color="red.fg"
      borderRadius="card"
      px={4}
      py={3}
      gap={3}
      align="flex-start"
      mb={4}
    >
      <Icon as={LuCircleAlert} boxSize={5} mt="2px" flexShrink={0} />
      <Text fontSize="sm">{message}</Text>
    </HStack>
  );
}

/** Non-blocking notice: something is degraded but the app still works. */
export function WarningBanner({ message }: { message: string }): JSX.Element {
  return (
    <HStack
      bg="orange.subtle"
      borderWidth="1px"
      borderColor="orange.emphasized"
      color="orange.fg"
      borderRadius="card"
      px={4}
      py={3}
      gap={3}
      align="flex-start"
      mb={4}
    >
      <Icon as={LuTriangleAlert} boxSize={5} mt="2px" flexShrink={0} />
      <Text fontSize="sm">{message}</Text>
    </HStack>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <Center py={{ base: 10, md: 16 }} px={4}>
      <Stack align="center" gap={3} maxW="420px" textAlign="center">
        <Icon as={LuInbox} boxSize={10} color="fg.subtle" />
        <Heading size="sm">{title}</Heading>
        {description ? (
          <Text fontSize="sm" color="fg.subtle">
            {description}
          </Text>
        ) : null}
        {action}
      </Stack>
    </Center>
  );
}
