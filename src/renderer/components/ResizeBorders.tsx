import { Box } from '@chakra-ui/react';
import { useEffect, useRef } from 'react';
import { type ResizeEdge, attachResizeEdge } from '../lib/drag-resize';

/**
 * Thickness of the invisible grab strips.
 *
 * These must be CSS length strings, not bare numbers: Chakra resolves a plain
 * number against its spacing scale, so `12` would become `3rem` (48px) and the
 * handles would sit on top of the titlebar buttons.
 */
const EDGE = '6px';
/** Corners are square and slightly larger, so they are easy to hit. */
const CORNER = '12px';

interface EdgeSpec {
  id: string;
  edge: ResizeEdge;
  cursor: string;
  style: Record<string, string>;
}

const EDGES: EdgeSpec[] = [
  {
    id: 'top',
    edge: { x: 0, y: -1 },
    cursor: 'ns-resize',
    style: { top: '0', left: CORNER, right: CORNER, height: EDGE },
  },
  {
    id: 'bottom',
    edge: { x: 0, y: 1 },
    cursor: 'ns-resize',
    style: { bottom: '0', left: CORNER, right: CORNER, height: EDGE },
  },
  {
    id: 'left',
    edge: { x: -1, y: 0 },
    cursor: 'ew-resize',
    style: { left: '0', top: CORNER, bottom: CORNER, width: EDGE },
  },
  {
    id: 'right',
    edge: { x: 1, y: 0 },
    cursor: 'ew-resize',
    style: { right: '0', top: CORNER, bottom: CORNER, width: EDGE },
  },
  {
    id: 'top-left',
    edge: { x: -1, y: -1 },
    cursor: 'nwse-resize',
    style: { top: '0', left: '0', width: CORNER, height: CORNER },
  },
  {
    id: 'top-right',
    edge: { x: 1, y: -1 },
    cursor: 'nesw-resize',
    style: { top: '0', right: '0', width: CORNER, height: CORNER },
  },
  {
    id: 'bottom-left',
    edge: { x: -1, y: 1 },
    cursor: 'nesw-resize',
    style: { bottom: '0', left: '0', width: CORNER, height: CORNER },
  },
  {
    id: 'bottom-right',
    edge: { x: 1, y: 1 },
    cursor: 'nwse-resize',
    style: { bottom: '0', right: '0', width: CORNER, height: CORNER },
  },
];

function EdgeHandle({ spec }: { spec: EdgeSpec }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    return node ? attachResizeEdge(node, spec.edge) : undefined;
  }, [spec.edge]);

  return (
    <Box
      ref={ref}
      position="absolute"
      cursor={spec.cursor}
      pointerEvents="auto"
      className="window-no-drag"
      {...spec.style}
    />
  );
}

/**
 * Invisible resize handles around the window edge.
 *
 * Hidden while maximised — the window has no edge to drag then — and skipped
 * entirely on native Wayland, where a client cannot reposition itself.
 */
export function ResizeBorders({ maximized }: { maximized: boolean }): JSX.Element | null {
  const enabled = typeof window !== 'undefined' && window.api?.useCustomResize;
  if (!enabled || maximized) {
    return null;
  }

  return (
    <Box position="absolute" inset="0" pointerEvents="none" zIndex={10}>
      {EDGES.map((spec) => (
        <EdgeHandle key={spec.id} spec={spec} />
      ))}
    </Box>
  );
}
