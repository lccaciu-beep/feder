// Unterdrückt Safari-Systemgesten, die eine Zeichen-App stören:
// Pinch-Zoom der Seite, Doppeltipp-Zoom, Long-Press-Menü und Lupe.
// Textfelder bleiben ausgenommen, damit dort Auswahl und Scribble funktionieren.

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

export function installSafariGuards(): () => void {
  const prevent = (e: Event) => e.preventDefault();
  const preventUnlessEditable = (e: Event) => {
    if (!isEditable(e.target)) e.preventDefault();
  };
  const multiTouch = (e: TouchEvent) => {
    if (e.touches.length > 1) e.preventDefault();
  };
  // Doppeltipp-Zoom verhindert `touch-action: manipulation` im CSS (global.css),
  // ein touchend-Handler würde schnelle Doppeltipps auf Buttons verschlucken.

  document.addEventListener('gesturestart', prevent, { passive: false });
  document.addEventListener('gesturechange', prevent, { passive: false });
  document.addEventListener('gestureend', prevent, { passive: false });
  document.addEventListener('dblclick', preventUnlessEditable, { passive: false });
  document.addEventListener('contextmenu', preventUnlessEditable);
  document.addEventListener('touchmove', multiTouch, { passive: false });

  return () => {
    document.removeEventListener('gesturestart', prevent);
    document.removeEventListener('gesturechange', prevent);
    document.removeEventListener('gestureend', prevent);
    document.removeEventListener('dblclick', preventUnlessEditable);
    document.removeEventListener('contextmenu', preventUnlessEditable);
    document.removeEventListener('touchmove', multiTouch);
  };
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
