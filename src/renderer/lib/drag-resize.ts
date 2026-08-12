import type { WindowBounds } from '../../shared/types';
import { invoke } from './api';

/**
 * Fake window-resizing borders.
 *
 * A frameless window has no OS grab handles, so the app draws eight thin strips
 * around the edge and turns pointer drags on them into `setBounds` calls. The
 * approach is the one from Fruitsalad/electron-custom-window-example, adapted
 * to this app's typed IPC bridge.
 *
 * Pointer capture matters here: without it the drag stops the moment the cursor
 * leaves the window, which is exactly what happens when you grow it.
 */

/** -1 = leading edge, 0 = not on this axis, 1 = trailing edge. */
export type EdgeDirection = -1 | 0 | 1;

export interface ResizeEdge {
  x: EdgeDirection;
  y: EdgeDirection;
}

const MIN_WIDTH = 720;
const MIN_HEIGHT = 520;

interface DragState {
  pointerId: number;
  edge: ResizeEdge;
  startScreenX: number;
  startScreenY: number;
  startBounds: WindowBounds;
}

/**
 * Attaches resize behaviour to one edge element.
 * Returns a cleanup function that removes every listener it added.
 */
export function attachResizeEdge(node: HTMLElement, edge: ResizeEdge): () => void {
  let drag: DragState | null = null;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    event.preventDefault();

    // Read the bounds first: the pointer may already have moved by the time
    // the IPC round-trip resolves, and the drag must start from a known rect.
    void invoke('window:getBounds').then((bounds) => {
      node.setPointerCapture?.(event.pointerId);
      drag = {
        pointerId: event.pointerId,
        edge,
        startScreenX: event.screenX,
        startScreenY: event.screenY,
        startBounds: bounds,
      };
    });
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const deltaX = event.screenX - drag.startScreenX;
    const deltaY = event.screenY - drag.startScreenY;
    void invoke('window:setBounds', nextBounds(drag.startBounds, drag.edge, deltaX, deltaY));
  };

  const endDrag = (event: PointerEvent): void => {
    if (drag && event.pointerId === drag.pointerId) {
      node.releasePointerCapture?.(event.pointerId);
      drag = null;
    }
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', endDrag);
  node.addEventListener('pointercancel', endDrag);

  return () => {
    node.removeEventListener('pointerdown', onPointerDown);
    node.removeEventListener('pointermove', onPointerMove);
    node.removeEventListener('pointerup', endDrag);
    node.removeEventListener('pointercancel', endDrag);
  };
}

/** Applies a drag delta to the starting rectangle, respecting the minimum size. */
export function nextBounds(
  start: WindowBounds,
  edge: ResizeEdge,
  deltaX: number,
  deltaY: number
): WindowBounds {
  const [x, width] = resizeAxis(start.x, start.width, deltaX, edge.x, MIN_WIDTH);
  const [y, height] = resizeAxis(start.y, start.height, deltaY, edge.y, MIN_HEIGHT);
  return { x, y, width, height };
}

/**
 * One axis of the resize.
 *
 * Dragging a leading edge moves the origin and shrinks the size; dragging a
 * trailing edge only grows it. Once the minimum is hit the origin is pinned,
 * otherwise the window would keep sliding while the size stayed put.
 */
function resizeAxis(
  origin: number,
  size: number,
  delta: number,
  direction: EdgeDirection,
  minimum: number
): [origin: number, size: number] {
  if (direction === -1) {
    const clamped = Math.min(delta, size - minimum);
    return [origin + clamped, size - clamped];
  }
  if (direction === 1) {
    return [origin, Math.max(size + delta, minimum)];
  }
  return [origin, size];
}
