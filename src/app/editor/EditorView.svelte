<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import Menu, { type MenuItem } from '../components/Menu.svelte';
  import ToolOptions from './ToolOptions.svelte';
  import Sidebar from './Sidebar.svelte';
  import PaperDialog from './PaperDialog.svelte';
  import { Editor, type EditorState, type ToolId } from '../../engine/Editor';
  import { NotebookDoc } from '../../engine/doc/NotebookDoc';
  import { getDb } from '../../storage/db';
  import { touchOpened } from '../../storage/library';
  import { router } from '../stores/router.svelte';
  import { settings } from '../stores/settings.svelte';
  import { toasts } from '../stores/toast.svelte';
  import type { Id } from '../../model/types';

  let { id, initialPage, onsettings }: { id: Id; initialPage?: number; onsettings: () => void } = $props();

  let host = $state<HTMLDivElement>();
  let barEl = $state<HTMLDivElement>();
  let editor = $state<Editor | null>(null);
  let doc = $state<NotebookDoc | null>(null);
  let st = $state<EditorState | null>(null);
  let title = $state('');
  let pageIds = $state<Id[]>([]);
  let versions = $state<Record<Id, number>>({});
  let showSidebar = $state(false);
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let paperFor = $state<Id | null>(null);
  let error = $state<string | null>(null);
  let zoomHint = $state<string | null>(null);
  let zoomTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    (async () => {
      try {
        const d = await NotebookDoc.load(getDb(), id);
        if (disposed) return;
        await touchOpened(id);
        doc = d;
        title = d.notebook.title;
        pageIds = [...d.pageIds];
        const ed = new Editor(host!, d, settings.snapshot(), {
          insets: insets(),
          initialPage: initialPage ?? 0,
        });
        editor = ed;
        cleanups.push(
          ed.onState((s) => {
            if (st && Math.abs(s.zoom - st.zoom) > 0.004) showZoom(s.zoom);
            st = s;
          }),
        );
        cleanups.push(
          d.on((c) => {
            if (c.structure) pageIds = [...d.pageIds];
            const next = { ...versions };
            for (const pid of c.items.keys()) next[pid] = (next[pid] ?? 0) + 1;
            for (const pid of c.pages) next[pid] = (next[pid] ?? 0) + 1;
            versions = next;
          }),
        );
        cleanups.push(
          d.autosave.onStatus((s) => {
            if (s === 'error') toasts.show('Speichern fehlgeschlagen – neuer Versuch läuft.');
          }),
        );
        // Beim Verlassen der App sofort speichern.
        const flush = () => void d.autosave.flush();
        const onVis = () => document.visibilityState === 'hidden' && flush();
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('pagehide', flush);
        cleanups.push(() => {
          document.removeEventListener('visibilitychange', onVis);
          window.removeEventListener('pagehide', flush);
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      disposed = true;
      for (const c of cleanups) c();
      editor?.destroy();
    };
  });

  function insets() {
    const h = barEl?.getBoundingClientRect().bottom ?? 120;
    return { top: h, right: 0, bottom: 0, left: 0 };
  }

  // Werkzeugleisten-Höhe kann sich ändern (Quer-/Hochformat, Split View).
  $effect(() => {
    if (!barEl || !editor) return;
    const ed = editor;
    const ro = new ResizeObserver(() => {
      ed.setInsets(insets());
      barEl!.parentElement?.style.setProperty('--toolbar-h', `${barEl!.getBoundingClientRect().bottom}px`);
    });
    ro.observe(barEl);
    return () => ro.disconnect();
  });

  // Einstellungen an die Engine weitergeben.
  $effect(() => {
    const snap = $state.snapshot(settings.value);
    editor?.updateSettings(snap as typeof settings.value);
  });

  function showZoom(z: number) {
    zoomHint = `${Math.round(z * 100)} %`;
    if (zoomTimer) clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => (zoomHint = null), 900);
  }

  function setTool(t: ToolId) {
    editor?.setTool(t);
  }

  function back() {
    void doc?.autosave.flush();
    router.go({ name: 'library', section: 'docs', folderId: doc?.notebook.folderId ?? null });
  }

  function addPage() {
    if (!doc || !editor || !st) return;
    const index = st.pageIndex + 1;
    doc.addPage(index);
    editor.goToPage(index);
  }

  function moreMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vertical = settings.value.scrollDirection === 'vertical';
    menu = {
      x: r.right - 240,
      y: r.bottom + 6,
      items: [
        {
          label: 'Vorlage ändern …',
          icon: 'template',
          run: () => (paperFor = doc?.pageIds[st?.pageIndex ?? 0] ?? null),
        },
        {
          label: vertical ? 'Seitlich blättern' : 'Vertikal blättern',
          icon: vertical ? 'scroll-h' : 'scroll',
          run: () => settings.update((v) => (v.scrollDirection = vertical ? 'horizontal' : 'vertical')),
        },
        { label: 'Seitenbreite einpassen', icon: 'fit', run: () => editor?.fitWidth() },
        { label: 'Einstellungen', icon: 'settings', run: onsettings },
      ],
    };
  }

  function applyPaper(pageId: Id, paper: import('../../model/types').PaperSpec, scope: 'page' | 'all') {
    if (!doc) return;
    doc.setPaper(scope === 'all' ? [...doc.pageIds] : [pageId], paper, scope === 'all');
  }

  function typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!editor || typing(e) || paperFor) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (mod && k === 'y') {
      e.preventDefault();
      editor.redo();
    } else if (mod && k === 'n') {
      e.preventDefault();
      addPage();
    } else if (mod && (k === '+' || k === '=')) {
      e.preventDefault();
      editor.zoomBy(1.25);
    } else if (mod && k === '-') {
      e.preventDefault();
      editor.zoomBy(0.8);
    } else if (mod && k === '0') {
      e.preventDefault();
      editor.fitWidth();
    } else if (!mod && !e.altKey) {
      if (k === 'p') setTool('pen');
      else if (k === 'h') setTool('highlighter');
      else if (k === 'e') setTool('eraser');
      else if (k === 'arrowright' || k === 'pagedown') editor.goToPage((st?.pageIndex ?? 0) + 1);
      else if (k === 'arrowleft' || k === 'pageup') editor.goToPage((st?.pageIndex ?? 0) - 1);
      else if (k === 'home') editor.goToPage(0);
      else if (k === 'end') editor.goToPage(pageIds.length - 1);
      else if (k === 'escape') showSidebar = false;
    }
  }

  const tools: { id: ToolId; label: string; icon: () => string; key: string }[] = [
    { id: 'pen', label: 'Stift', icon: () => settings.value.pen.kind, key: 'P' },
    { id: 'highlighter', label: 'Textmarker', icon: () => 'highlighter', key: 'H' },
    { id: 'eraser', label: 'Radierer', icon: () => 'eraser', key: 'E' },
  ];

  const saveLabel = $derived(
    st?.saveStatus === 'error'
      ? 'Nicht gespeichert'
      : st?.saveStatus === 'saved'
        ? 'Gespeichert'
        : 'Speichert …',
  );
</script>

<svelte:window {onkeydown} />

<div class="editor-shell">
  <div class="canvas-host" bind:this={host}></div>

  <div class="bars" bind:this={barEl}>
    <div class="bar">
      <div class="left">
        <button class="icon-btn" onclick={back} aria-label="Zur Bibliothek"><Icon name="back" /></button>
        <button
          class="icon-btn"
          class:on={showSidebar}
          onclick={() => (showSidebar = !showSidebar)}
          aria-label="Seitenübersicht"
          aria-pressed={showSidebar}><Icon name="pages" /></button
        >
        <span class="title" {title}>{title}</span>
      </div>

      <div class="center" role="toolbar" aria-label="Werkzeuge">
        {#each tools as t (t.id)}
          <button
            class="tool"
            class:on={st?.tool === t.id}
            onclick={() => setTool(t.id)}
            aria-label="{t.label} ({t.key})"
            aria-pressed={st?.tool === t.id}
          >
            <Icon name={t.icon()} />
            {#if t.id !== 'eraser'}
              <span
                class="ink"
                style:background={t.id === 'pen'
                  ? settings.value.pen.color
                  : settings.value.highlighter.color}
              ></span>
            {/if}
          </button>
        {/each}
        <span class="sep"></span>
        <button
          class="icon-btn"
          disabled={!st?.canUndo}
          onclick={() => editor?.undo()}
          aria-label="Rückgängig (⌘Z)"><Icon name="undo" /></button
        >
        <button
          class="icon-btn"
          disabled={!st?.canRedo}
          onclick={() => editor?.redo()}
          aria-label="Wiederholen (⇧⌘Z)"><Icon name="redo" /></button
        >
      </div>

      <div class="right">
        <span class="save" class:err={st?.saveStatus === 'error'} aria-live="polite">{saveLabel}</span>
        <button class="icon-btn" onclick={addPage} aria-label="Seite einfügen (⌘N)"
          ><Icon name="page-plus" /></button
        >
        <button class="icon-btn" onclick={moreMenu} aria-label="Weitere Optionen"><Icon name="more" /></button
        >
      </div>
    </div>
    {#if st}
      <div class="sub">
        <ToolOptions tool={st.tool} />
      </div>
    {/if}
  </div>

  {#if showSidebar && doc}
    <Sidebar
      {doc}
      {pageIds}
      {versions}
      current={st?.pageIndex ?? 0}
      ongo={(i) => editor?.goToPage(i)}
      onpaper={(pid) => (paperFor = pid)}
      onclose={() => (showSidebar = false)}
    />
  {/if}

  {#if st}
    <button class="pager" onclick={() => (showSidebar = !showSidebar)} aria-label="Seitenübersicht öffnen">
      {zoomHint ?? `${st.pageIndex + 1} / ${st.pageCount}`}
    </button>
  {/if}

  {#if error}
    <div class="error">
      <p>Das Notizbuch ließ sich nicht öffnen: {error}</p>
      <button class="btn primary" onclick={back}>Zur Bibliothek</button>
    </div>
  {/if}
</div>

{#if menu}
  <Menu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

{#if paperFor && doc}
  {@const pid = paperFor}
  {@const page = doc.pages.get(pid)}
  {#if page}
    <PaperDialog
      paper={page.paper}
      onclose={() => (paperFor = null)}
      onapply={(p, scope) => applyPaper(pid, p, scope)}
    />
  {/if}
{/if}

<style>
  .editor-shell {
    position: fixed;
    inset: 0;
    background: var(--desk);
  }
  .canvas-host {
    position: absolute;
    inset: 0;
  }
  .bars {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: calc(8px + var(--safe-top)) calc(10px + var(--safe-right)) 8px calc(10px + var(--safe-left));
    pointer-events: none;
    z-index: 10;
  }
  .bar,
  .sub {
    pointer-events: auto;
  }
  .bar {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 18px;
    background: var(--bar);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow-lift);
  }
  .left,
  .right,
  .center {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .right {
    justify-content: flex-end;
  }
  .title {
    margin-left: 6px;
    font-weight: 600;
    font-size: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tool {
    position: relative;
    display: grid;
    place-items: center;
    width: 48px;
    height: 44px;
    border-radius: 12px;
  }
  .tool.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  /* Tintenfarbe als kleiner Tropfen am Werkzeug */
  .ink {
    position: absolute;
    right: 7px;
    bottom: 6px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px var(--bar);
  }
  .sep {
    width: 1px;
    height: 24px;
    margin: 0 6px;
    background: var(--line);
  }
  .save {
    font: 12px var(--font-ui);
    color: var(--muted);
    margin-right: 6px;
    white-space: nowrap;
  }
  .save.err {
    color: var(--danger);
    font-weight: 600;
  }
  .pager {
    position: absolute;
    left: 50%;
    bottom: calc(14px + var(--safe-bottom));
    transform: translateX(-50%);
    min-width: 64px;
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--bar);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow-lift);
    font: 600 13px var(--font-ui);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    z-index: 10;
  }
  .error {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: var(--bg);
    z-index: 30;
    font-family: var(--font-ui);
  }
  @media (max-width: 760px) {
    .title,
    .save {
      display: none;
    }
    .tool {
      width: 42px;
    }
  }
</style>
