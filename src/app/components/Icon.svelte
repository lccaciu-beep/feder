<script lang="ts" module>
  // Eigene Linien-Icons, 24×24, Strichstärke 1.75.
  const ICONS: Record<string, string> = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    pages: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M9.5 4v16"/>',
    fountain:
      '<path d="M12 3c3 2.2 4.6 5.4 3.8 8.2L12 17l-3.8-5.8C7.4 8.4 9 5.2 12 3z"/><path d="M12 17v-6"/><circle cx="12" cy="10" r="0.9" fill="currentColor" stroke="none"/><path d="M5 21h14"/>',
    ballpoint: '<path d="M14.5 3.5l6 6L9 21H3v-6z"/><path d="M12 6l6 6"/>',
    brush:
      '<path d="M20 4c-3.5 1.5-8 6.2-9.6 8.4l1.2 1.2C13.8 12 18.5 7.5 20 4z"/><path d="M10.4 12.4c-2.6-.4-4.6 1.4-4.9 4.2-.2 1.6-1 2.6-2.5 3.4 4 .9 7.4-.2 8.6-2.4.6-1.1.6-2.3 0-3.4"/>',
    pencil:
      '<path d="M4 20l1.2-4.6L16.6 4a1.9 1.9 0 012.7 0l.7.7a1.9 1.9 0 010 2.7L8.6 18.8z"/><path d="M14.5 6l3.5 3.5"/>',
    highlighter:
      '<path d="M9 14.5l-2.5 2.5v2.5h3L12 17"/><path d="M9 14.5L17.5 6a2 2 0 012.8 0v0a2 2 0 010 2.8L12 17z"/><path d="M3 21h8"/>',
    eraser:
      '<path d="M8.5 20H20"/><path d="M4.4 15.6l9.2-9.2a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L13 19a3.4 3.4 0 01-4.8 0l-3.8-.6a1.8 1.8 0 010-2.8z"/><path d="M9.5 10.5l5.5 5.5"/>',
    undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 010 10H11"/>',
    redo: '<path d="M15 7l4.5 4.5L15 16"/><path d="M19 11.5H9.5a5 5 0 000 10H13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.5 7.5 0 01-2.3 1.3L14.5 21h-4l-.3-2.3a7.5 7.5 0 01-2.3-1.3l-1.9.7-2-3.4 1.6-1.2a7.6 7.6 0 010-3l-1.6-1.2 2-3.4 1.9.7a7.5 7.5 0 012.3-1.3L10.5 3h4l.3 2.3a7.5 7.5 0 012.3 1.3l1.9-.7 2 3.4-1.6 1.2a7.6 7.6 0 010 3z"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/>',
    folder: '<path d="M3.5 7.5a2 2 0 012-2h3.8l2 2.2h7.2a2 2 0 012 2v7.8a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>',
    'folder-move':
      '<path d="M3.5 7.5a2 2 0 012-2h3.8l2 2.2h7.2a2 2 0 012 2v7.8a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/><path d="M10 13.5h5.5M13.5 11l2.5 2.5-2.5 2.5"/>',
    star: '<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/>',
    'star-filled':
      '<path fill="currentColor" d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/>',
    trash:
      '<path d="M4.5 7h15M10 4h4M6.5 7l.9 12a2 2 0 002 1.8h5.2a2 2 0 002-1.8l.9-12"/><path d="M10 11v6M14 11v6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5"/><path d="M13 6h7M13 11h5M13 16h3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    restore: '<path d="M4 12a8 8 0 102.6-5.9"/><path d="M4 4.5v4h4"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2"/>',
    rename: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M13 20h7"/>',
    page: '<path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12z"/><path d="M14 3.5V8h4.5"/>',
    'page-plus':
      '<path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12z"/><path d="M14 3.5V8h4.5"/><path d="M12.5 11.5v6M9.5 14.5h6"/>',
    template: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8 8h8M8 11.5h8M8 15h8"/>',
    fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
    scroll: '<path d="M12 4v16M8.5 7.5L12 4l3.5 3.5M8.5 16.5L12 20l3.5-3.5"/>',
    'scroll-h': '<path d="M4 12h16M7.5 8.5L4 12l3.5 3.5M16.5 8.5L20 12l-3.5 3.5"/>',
    notebook: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 3.5v17"/>',
    straight:
      '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none"/>',
  };
</script>

<script lang="ts">
  let { name, size = 24, label }: { name: string; size?: number; label?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  {@html ICONS[name] ?? ''}
</svg>
