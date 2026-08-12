import { HStack, Icon } from '@chakra-ui/react';
import { LuCopy, LuMinus, LuSquare, LuX } from 'react-icons/lu';
import { invoke } from '../lib/api';

/**
 * Windows-style minimise / maximise / close buttons for the custom titlebar.
 *
 * Close hides to the tray instead of quitting, matching what the OS close
 * button did before the frame was removed: the background service keeps
 * running, and Quit lives in the tray menu.
 */

interface ControlButtonProps {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}

function ControlButton({ label, onClick, danger, children }: ControlButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={danger ? 'window-control window-control--danger' : 'window-control'}
    >
      {children}
    </button>
  );
}

export interface WindowControlsProps {
  maximized: boolean;
  onMaximizeChange: (maximized: boolean) => void;
}

export function WindowControls({ maximized, onMaximizeChange }: WindowControlsProps): JSX.Element {
  const toggleMaximize = (): void => {
    void invoke('window:toggleMaximize').then(onMaximizeChange);
  };

  return (
    <HStack gap={0} className="window-no-drag" flexShrink={0}>
      <ControlButton label="Minimise" onClick={() => void invoke('window:minimize')}>
        <Icon as={LuMinus} boxSize={4} />
      </ControlButton>
      <ControlButton label={maximized ? 'Restore' : 'Maximise'} onClick={toggleMaximize}>
        <Icon as={maximized ? LuCopy : LuSquare} boxSize={3.5} />
      </ControlButton>
      <ControlButton label="Close to tray" danger onClick={() => void invoke('window:close')}>
        <Icon as={LuX} boxSize={4} />
      </ControlButton>
    </HStack>
  );
}
