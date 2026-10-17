// Antippen, langes Drücken (Kontextmenü) und Ziehen für Bibliotheks-Kacheln.
// Funktioniert gleich mit Finger, Stift und Maus.

export interface PressOptions {
  tap: (x: number, y: number) => void;
  menu: (x: number, y: number) => void;
  /** Wird nach langem Drücken + Bewegen aufgerufen; ab dann übernimmt der Aufrufer. */
  drag?: (e: PointerEvent) => void;
}

const LONG_PRESS_MS = 450;
const SLOP = 8;

export function press(node: HTMLElement, initial: PressOptions) {
  let opts = initial;
  let pid: number | null = null;
  let sx = 0;
  let sy = 0;
  let lifted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pid = null;
    lifted = false;
    node.classList.remove('lifted');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', cleanup);
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pid !== null) return;
    pid = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
    lifted = false;
    timer = setTimeout(() => {
      lifted = true;
      node.classList.add('lifted');
    }, LONG_PRESS_MS);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cleanup);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    const d = Math.hypot(e.clientX - sx, e.clientY - sy);
    if (d <= SLOP) return;
    if (!lifted) {
      cleanup(); // normales Scrollen
      return;
    }
    if (opts.drag) {
      const drag = opts.drag;
      cleanup();
      drag(e);
    }
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    const wasLifted = lifted;
    cleanup();
    if (wasLifted) opts.menu(e.clientX, e.clientY);
    else opts.tap(e.clientX, e.clientY);
  };

  // Nach dem Anheben darf die Liste nicht mehr scrollen.
  const onTouchMove = (e: TouchEvent) => {
    if (lifted) e.preventDefault();
  };

  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    cleanup();
    opts.menu(e.clientX, e.clientY);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      opts.tap(r.left + r.width / 2, r.top + r.height / 2);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      opts.menu(r.left + r.width / 2, r.top + r.height / 2);
    }
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('touchmove', onTouchMove, { passive: false });
  node.addEventListener('contextmenu', onContext);
  node.addEventListener('keydown', onKey);

  return {
    update(next: PressOptions) {
      opts = next;
    },
    destroy() {
      cleanup();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('contextmenu', onContext);
      node.removeEventListener('keydown', onKey);
    },
  };
}
