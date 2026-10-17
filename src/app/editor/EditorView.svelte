<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import Menu, { type MenuItem } from '../components/Menu.svelte';
  import PromptDialog from '../components/PromptDialog.svelte';
  import ToolOptions from './ToolOptions.svelte';
  import Sidebar from './Sidebar.svelte';
  import PaperDialog from './PaperDialog.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import TextEditor from './TextEditor.svelte';
  import ElementsPopover from './ElementsPopover.svelte';
  import CropDialog from './CropDialog.svelte';
  import ExportDialog from '../components/ExportDialog.svelte';
  import ScanDialog from '../components/ScanDialog.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import LinkDialog from './LinkDialog.svelte';
  import AudioPanel from './AudioPanel.svelte';
  import FlashcardDialog from './FlashcardDialog.svelte';
  import { blobToDataUrl } from '../../storage/elements';
  import { AudioRecorder, formatDuration, recordingSupported } from '../../audio/recorder';
  import { liveQuery } from 'dexie';
  import { toggleBookmark } from '../../storage/structure';
  import { ui } from '../stores/ui.svelte';
  import { scanPaper } from '../../io/scan/scanPage';
  import { makePage } from '../../storage/library';
  import { insertPdfPages } from '../../pdf/import';
  import {
    Editor,
    type EditorState,
    type SelectionInfo,
    type TextEditInfo,
    type ToolId,
  } from '../../engine/Editor';
  import { NotebookDoc } from '../../engine/doc/NotebookDoc';
  import { getDb } from '../../storage/db';
  import { touchOpened } from '../../storage/library';
  import { saveElement } from '../../storage/elements';
  import { shareOrDownload } from '../../io/share';
  import { safeFileName } from '../../io/backup';
  import { router } from '../stores/router.svelte';
  import { settings } from '../stores/settings.svelte';
  import { toasts } from '../stores/toast.svelte';
  import type { Id, ImageItem, LinkTarget, PaperSpec } from '../../model/types';

  let {
    id,
    initialPage,
    initialPageId,
    onsettings,
  }: { id: Id; initialPage?: number; initialPageId?: string; onsettings: () => void } = $props();

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
  let showExport = $state(false);
  let pdfInput = $state<HTMLInputElement>();
  let imageInput = $state<HTMLInputElement>();
  let selection = $state.raw<SelectionInfo | null>(null);
  let textEdit = $state.raw<TextEditInfo | null>(null);
  let lassoOffer = $state<{ x: number; y: number } | null>(null);
  let zoomWin = $state<{ height: number } | null>(null);
  let elementsAt = $state<{ x: number; y: number } | null>(null);
  let saveElementOpen = $state(false);
  let cropItem = $state.raw<ImageItem | null>(null);
  let scanOpen = $state(false);
  let searchOpen = $state(false);
  let searchInitial = $state('');
  let linkOpen = $state(false);
  let audioOpen = $state(false);
  let flashcard = $state<{ front: string; pageId: Id | null } | null>(null);

  async function makeFlashcard() {
    if (!editor) return;
    const pageId = editor.selection?.pageId ?? null;
    const png = await editor.selectionImage(2);
    if (!png) return;
    flashcard = { front: await blobToDataUrl(png), pageId };
  }
  const recorder = new AudioRecorder();
  let recording = $state(false);
  let recElapsed = $state(0);
  let recTimer: ReturnType<typeof setInterval> | null = null;

  async function toggleRecording() {
    if (!doc) return;
    if (recording) {
      if (recTimer) clearInterval(recTimer);
      recording = false;
      const clip = await recorder.stop(doc.id);
      if (clip) toasts.show(`Aufnahme gespeichert (${formatDuration(clip.duration)})`);
      return;
    }
    try {
      await recorder.start();
      recording = true;
      recElapsed = 0;
      recTimer = setInterval(() => (recElapsed = Date.now() - recorder.startedAt), 500);
    } catch (err) {
      toasts.show(`Aufnahme nicht möglich: ${err instanceof Error ? err.message : String(err)}`, {
        ms: 6000,
      });
    }
  }
  const bookmarksQ = liveQuery(() => getDb().bookmarks.where('notebookId').equals(id).toArray());
  const currentPageId = $derived(doc && st ? (pageIds[st.pageIndex] ?? null) : null);
  const isBookmarked = $derived(
    !!currentPageId && ($bookmarksQ ?? []).some((b) => b.pageId === currentPageId),
  );

  function toggleCurrentBookmark() {
    if (!doc || !currentPageId || !st) return;
    const pid = currentPageId;
    const n = st.pageIndex + 1;
    void toggleBookmark(doc.id, pid, `Seite ${n}`).then((on) =>
      toasts.show(on ? `Lesezeichen auf Seite ${n} gesetzt` : 'Lesezeichen entfernt'),
    );
  }

  async function addScan(blob: Blob, width: number, height: number) {
    if (!doc || !editor) return;
    const paper = await scanPaper(blob, width, height);
    const index = (st?.pageIndex ?? 0) + 1;
    doc.insertPages(index, [makePage(doc.id, paper)], 'Scan einfügen');
    editor.goToPage(index);
  }
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
          initialPage: initialPageId ? Math.max(0, d.indexOf(initialPageId)) : (initialPage ?? 0),
        });
        editor = ed;
        ui.openTab(d.id, d.notebook.title);
        if (ui.pendingSearch) {
          searchInitial = ui.pendingSearch;
          ui.pendingSearch = null;
          searchOpen = true;
        }
        cleanups.push(
          ed.onState((s) => {
            if (st && Math.abs(s.zoom - st.zoom) > 0.004) showZoom(s.zoom);
            st = s;
          }),
        );
        cleanups.push(
          ed.onEvent((e) => {
            if (e.type === 'selection') selection = e.info;
            else if (e.type === 'textEdit') textEdit = e.info;
            else if (e.type === 'lassoOffer') lassoOffer = e.info;
            else if (e.type === 'zoomWindow') zoomWin = e.info;
            else if (e.type === 'link') openLink(e.target);
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
        const flush = () => {
          ed.finishTextEdit();
          void d.autosave.flush();
        };
        const onVis = () => document.visibilityState === 'hidden' && flush();
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('pagehide', flush);
        window.addEventListener('paste', onPaste);
        cleanups.push(() => {
          document.removeEventListener('visibilitychange', onVis);
          window.removeEventListener('pagehide', flush);
          window.removeEventListener('paste', onPaste);
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      disposed = true;
      if (recording && doc) void recorder.stop(doc.id);
      if (recTimer) clearInterval(recTimer);
      for (const c of cleanups) c();
      editor?.finishTextEdit();
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
    editor?.finishTextEdit();
    void doc?.autosave.flush();
    router.go({ name: 'library', section: 'docs', folderId: doc?.notebook.folderId ?? null });
  }

  function addPage() {
    if (!doc || !editor || !st) return;
    const index = st.pageIndex + 1;
    doc.addPage(index);
    editor.goToPage(index);
  }

  async function onPdfPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !doc || !editor) return;
    const busy = toasts.show(`Füge „${file.name}“ ein …`, { sticky: true });
    try {
      const index = (st?.pageIndex ?? 0) + 1;
      const pages = await insertPdfPages(doc, file, index);
      editor.goToPage(index);
      toasts.show(`${pages.length} ${pages.length === 1 ? 'Seite' : 'Seiten'} eingefügt`);
    } catch (err) {
      toasts.show(`PDF konnte nicht eingefügt werden: ${err instanceof Error ? err.message : String(err)}`, {
        ms: 6000,
      });
    } finally {
      toasts.dismiss(busy);
    }
  }

  async function onImagePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    for (const f of files) await insertImage(f);
  }

  async function insertImage(file: Blob) {
    try {
      await editor?.insertImage(file);
    } catch (err) {
      toasts.show(`Bild konnte nicht eingefügt werden: ${err instanceof Error ? err.message : String(err)}`, {
        ms: 6000,
      });
    }
  }

  /** Bilder aus der Zwischenablage einfügen (⌘V). */
  function onPaste(e: ClipboardEvent) {
    if (!editor || typing(e) || textEdit) return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      void insertImage(file);
    } else if (editor.canPaste) {
      e.preventDefault();
      editor.paste();
    }
  }

  function openLink(t: LinkTarget) {
    if (t.kind === 'url') window.open(t.url, '_blank', 'noopener');
    else if (t.kind === 'notebook') {
      editor?.finishTextEdit();
      void doc?.autosave.flush();
      router.go({ name: 'notebook', id: t.notebookId, pageId: t.pageId });
    }
  }

  function moreMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vertical = settings.value.scrollDirection === 'vertical';
    menu = {
      x: r.right - 240,
      y: r.bottom + 6,
      items: [
        {
          label: st?.readMode ? 'Lesemodus beenden' : 'Lesemodus',
          icon: 'notebook',
          run: () => editor?.setReadMode(!st?.readMode),
        },
        { label: 'Aufnahmen anhören …', icon: 'headphones', run: () => (audioOpen = true) },
        { label: 'Exportieren …', icon: 'share', run: () => (showExport = true) },
        { label: 'PDF einfügen …', icon: 'page-plus', run: () => pdfInput?.click() },
        { label: 'Dokument scannen …', icon: 'image', run: () => (scanOpen = true) },
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

  function applyPaper(pageId: Id, paper: PaperSpec, scope: 'page' | 'all') {
    if (!doc) return;
    // „Alle Seiten“ lässt importierte PDF-Seiten unangetastet.
    const ids =
      scope === 'all'
        ? doc.pageIds.filter((id) => doc!.pages.get(id)?.paper.template.kind !== 'pdf')
        : [pageId];
    doc.setPaper(ids, paper, scope === 'all');
  }

  async function shareSelectionImage() {
    const blob = await editor?.selectionImage();
    if (!blob) return;
    const r = await shareOrDownload(blob, safeFileName(`${title} – Auswahl`, 'png'));
    if (r === 'downloaded') toasts.show('Bild wurde heruntergeladen.');
  }

  async function storeElement(name: string) {
    if (!editor) return;
    const items = editor.selectedItems();
    try {
      await saveElement(name, items, await editor.selectionImage(1));
      toasts.show(`Element „${name}“ gespeichert`);
    } catch (err) {
      toasts.show(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleZoomWindow() {
    if (!editor) return;
    if (editor.zoomWindowOpen) editor.closeZoomWindow();
    else editor.openZoomWindow();
  }

  function typing(e: Event) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!editor || typing(e) || paperFor || showExport || cropItem || saveElementOpen) return;
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
    } else if (mod && k === 'f') {
      e.preventDefault();
      searchOpen = true;
    } else if (mod && k === 'b') {
      e.preventDefault();
      toggleCurrentBookmark();
    } else if (mod && k === 'a') {
      e.preventDefault();
      editor.selectAll();
    } else if (mod && k === 'c' && selection) {
      e.preventDefault();
      editor.copySelection();
    } else if (mod && k === 'x' && selection) {
      e.preventDefault();
      editor.cutSelection();
    } else if (mod && k === 'd' && selection) {
      e.preventDefault();
      editor.duplicateSelection();
    } else if (!mod && !e.altKey) {
      const map: Record<string, ToolId> = {
        p: 'pen',
        h: 'highlighter',
        e: 'eraser',
        l: 'lasso',
        s: 'shape',
        t: 'text',
        b: 'tape',
        x: 'laser',
      };
      if (map[k]) setTool(map[k]);
      else if ((k === 'backspace' || k === 'delete') && selection) {
        e.preventDefault();
        editor.deleteSelection();
      } else if (k === 'arrowright' || k === 'pagedown') editor.goToPage((st?.pageIndex ?? 0) + 1);
      else if (k === 'arrowleft' || k === 'pageup') editor.goToPage((st?.pageIndex ?? 0) - 1);
      else if (k === 'home') editor.goToPage(0);
      else if (k === 'end') editor.goToPage(pageIds.length - 1);
      else if (k === 'escape') {
        if (selection) editor.clearSelection();
        else showSidebar = false;
      }
    }
  }

  const tools: { id: ToolId; label: string; icon: () => string; key: string; ink?: () => string }[] = [
    {
      id: 'pen',
      label: 'Stift',
      icon: () => settings.value.pen.kind,
      key: 'P',
      ink: () => settings.value.pen.color,
    },
    {
      id: 'highlighter',
      label: 'Textmarker',
      icon: () => 'highlighter',
      key: 'H',
      ink: () => settings.value.highlighter.color,
    },
    { id: 'eraser', label: 'Radierer', icon: () => 'eraser', key: 'E' },
    { id: 'lasso', label: 'Lasso', icon: () => 'lasso', key: 'L' },
    { id: 'shape', label: 'Formen', icon: () => 'shapes', key: 'S', ink: () => settings.value.shape.color },
    { id: 'text', label: 'Text', icon: () => 'text', key: 'T' },
    { id: 'tape', label: 'Tape', icon: () => 'tape', key: 'B', ink: () => settings.value.tape.color },
    { id: 'laser', label: 'Laserpointer', icon: () => 'laser', key: 'X' },
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
  <input bind:this={pdfInput} type="file" accept="application/pdf,.pdf" hidden onchange={onPdfPicked} />
  <input bind:this={imageInput} type="file" accept="image/*" multiple hidden onchange={onImagePicked} />
  <div class="canvas-host" bind:this={host}></div>

  <div class="bars" bind:this={barEl}>
    {#if ui.tabs.length > 1}
      <div class="tabbar" role="tablist" aria-label="Geöffnete Notizbücher">
        {#each ui.tabs as t (t.id)}
          <div class="tab" class:on={t.id === id}>
            <button
              role="tab"
              aria-selected={t.id === id}
              onclick={() => {
                if (t.id === id) return;
                editor?.finishTextEdit();
                void doc?.autosave.flush();
                router.go({ name: 'notebook', id: t.id });
              }}>{t.title}</button
            >
            <button
              class="x"
              aria-label="Tab {t.title} schließen"
              onclick={() => {
                ui.closeTab(t.id);
                if (t.id === id) {
                  const next = ui.tabs[ui.tabs.length - 1];
                  if (next) router.go({ name: 'notebook', id: next.id });
                  else back();
                }
              }}><Icon name="close" size={14} /></button
            >
          </div>
        {/each}
      </div>
    {/if}
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

      {#if st?.readMode}
        <div class="center read">
          <span>Lesemodus</span>
          <button class="btn" onclick={() => editor?.setReadMode(false)}>Bearbeiten</button>
        </div>
      {:else}
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
              {#if t.ink}
                <span class="ink" style:background={t.ink()}></span>
              {/if}
            </button>
          {/each}
          <span class="sep"></span>
          <button class="icon-btn" onclick={() => imageInput?.click()} aria-label="Bild einfügen"
            ><Icon name="image" /></button
          >
          <button
            class="icon-btn"
            class:on={!!elementsAt}
            onclick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              elementsAt = elementsAt ? null : { x: r.left - 140, y: r.bottom + 8 };
            }}
            aria-label="Elemente"><Icon name="sticker" /></button
          >
          <button
            class="icon-btn"
            class:on={!!zoomWin}
            onclick={toggleZoomWindow}
            aria-label="Zoom-Fenster"
            aria-pressed={!!zoomWin}><Icon name="magnifier" /></button
          >
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
      {/if}

      <div class="right">
        <span class="save" class:err={st?.saveStatus === 'error'} aria-live="polite">{saveLabel}</span>
        {#if recordingSupported()}
          <button
            class="icon-btn rec"
            class:recording
            onclick={() => void toggleRecording()}
            aria-label={recording ? 'Aufnahme beenden' : 'Audio aufnehmen'}
            aria-pressed={recording}
            ><Icon name={recording ? 'stop' : 'mic'} />{#if recording}<span class="rec-time"
                >{formatDuration(recElapsed)}</span
              >{/if}</button
          >
        {/if}
        <button
          class="icon-btn"
          class:on={searchOpen}
          onclick={() => (searchOpen = !searchOpen)}
          aria-label="Im Notizbuch suchen (⌘F)"
          aria-pressed={searchOpen}><Icon name="search" /></button
        >
        <button
          class="icon-btn bookmark"
          class:marked={isBookmarked}
          onclick={toggleCurrentBookmark}
          aria-label={isBookmarked ? 'Lesezeichen entfernen (⌘B)' : 'Lesezeichen setzen (⌘B)'}
          aria-pressed={isBookmarked}><Icon name={isBookmarked ? 'bookmark-filled' : 'bookmark'} /></button
        >
        <button class="icon-btn" onclick={addPage} aria-label="Seite einfügen (⌘N)"
          ><Icon name="page-plus" /></button
        >
        <button class="icon-btn" onclick={moreMenu} aria-label="Weitere Optionen"><Icon name="more" /></button
        >
      </div>
    </div>
    {#if st && !st.readMode}
      <div class="sub">
        <ToolOptions tool={st.tool} {editor} />
      </div>
    {/if}
  </div>

  {#if editor && selection && !textEdit}
    <SelectionBar
      {editor}
      info={selection}
      onsaveelement={() => (saveElementOpen = true)}
      onshareimage={() => void shareSelectionImage()}
      oncrop={() => (cropItem = selection?.single?.type === 'image' ? selection.single : null)}
      onlink={() => (linkOpen = true)}
      onflashcard={() => void makeFlashcard()}
    />
  {/if}

  {#if editor && textEdit}
    <TextEditor {editor} info={textEdit} />
  {/if}

  {#if lassoOffer}
    <button
      class="offer"
      style:left="{lassoOffer.x + 8}px"
      style:top="{Math.max(70, lassoOffer.y - 44)}px"
      onclick={() => editor?.acceptLassoOffer()}
    >
      <Icon name="lasso" size={18} /> Auswählen
    </button>
  {/if}

  {#if zoomWin}
    <div class="zoom-controls" style:bottom="{zoomWin.height + 10}px">
      <button class="btn" onclick={() => editor?.zoomWindowNewLine()}
        ><Icon name="new-line" size={18} /> Neue Zeile</button
      >
      <button class="btn" onclick={() => editor?.zoomWindowAdvance()}
        ><Icon name="arrow-right" size={18} /> Weiter</button
      >
      <button class="btn" onclick={() => editor?.closeZoomWindow()} aria-label="Zoom-Fenster schließen"
        ><Icon name="close" size={18} /></button
      >
    </div>
  {/if}

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

  {#if st && !zoomWin}
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

{#if elementsAt && editor}
  {@const ed = editor}
  <ElementsPopover
    x={elementsAt.x}
    y={elementsAt.y}
    onpick={(def) => ed.insertElement(def)}
    onclose={() => (elementsAt = null)}
  />
{/if}

{#if saveElementOpen}
  <PromptDialog
    title="Als Element speichern"
    value="Element"
    confirm="Speichern"
    onclose={() => (saveElementOpen = false)}
    onsubmit={(name) => void storeElement(name)}
  />
{/if}

{#if cropItem && editor}
  {@const ed = editor}
  {@const img = cropItem}
  <CropDialog
    item={img}
    onclose={() => (cropItem = null)}
    onapply={(crop) => {
      const k = img.box.w / img.crop.w;
      const w = crop.w * k;
      const h = crop.h * k;
      ed.updateItems(
        [{ before: img, after: { ...img, crop, box: { x: img.box.x, y: img.box.y, w, h } } }],
        'Zuschneiden',
      );
    }}
  />
{/if}

{#if flashcard && doc}
  <FlashcardDialog
    front={flashcard.front}
    notebookId={doc.id}
    notebookTitle={doc.notebook.title}
    pageId={flashcard.pageId}
    onclose={() => (flashcard = null)}
  />
{/if}

{#if audioOpen && doc && editor}
  <AudioPanel {editor} notebookId={doc.id} onclose={() => (audioOpen = false)} />
{/if}

{#if searchOpen && doc && editor}
  <SearchPanel {doc} {editor} initial={searchInitial} onclose={() => (searchOpen = false)} />
{/if}

{#if linkOpen && doc && editor}
  {@const ed = editor}
  <LinkDialog
    pageCount={pageIds.length}
    {pageIds}
    currentNotebook={doc.id}
    onclose={() => (linkOpen = false)}
    oncreate={(target, label) => ed.addLink(target, label)}
  />
{/if}

{#if scanOpen}
  <ScanDialog onclose={() => (scanOpen = false)} onresult={(b, w, h) => void addScan(b, w, h)} />
{/if}

{#if showExport && doc}
  {@const pid = doc.pageIds[st?.pageIndex ?? 0] ?? null}
  <ExportDialog
    notebook={doc.notebook}
    currentPageId={pid}
    currentPageNumber={(st?.pageIndex ?? 0) + 1}
    onclose={() => (showExport = false)}
  />
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
  .sub,
  .tabbar {
    pointer-events: auto;
  }
  .bar {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 18px;
    background: var(--bar);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow-lift);
  }
  .tabbar {
    display: flex;
    gap: 4px;
    width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab {
    display: flex;
    align-items: center;
    max-width: 220px;
    border-radius: 10px;
    background: var(--bar);
    box-shadow: var(--shadow-lift);
    font: 500 13px var(--font-ui);
    color: var(--muted);
    flex: none;
  }
  .tab.on {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
  }
  .tab button[role='tab'] {
    padding: 6px 4px 6px 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab .x {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-right: 4px;
    border-radius: 8px;
  }
  .center.read {
    gap: 12px;
    font: 600 14px var(--font-ui);
    color: var(--muted);
  }
  .left,
  .right,
  .center {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .left {
    max-width: 260px;
  }
  .center {
    justify-content: safe center;
    overflow-x: auto;
    scrollbar-width: none;
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
    width: 44px;
    height: 44px;
    border-radius: 12px;
    flex: none;
  }
  .tool.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .center .icon-btn {
    flex: none;
  }
  .center .icon-btn.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  /* Tintenfarbe als kleiner Tropfen am Werkzeug */
  .ink {
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px var(--bar);
  }
  .sep {
    width: 1px;
    height: 24px;
    margin: 0 4px;
    background: var(--line);
    flex: none;
  }
  .right .icon-btn.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .rec.recording {
    width: auto;
    padding: 0 10px;
    gap: 6px;
    display: inline-flex;
    color: #fff;
    background: #d63031;
  }
  .rec-time {
    font: 600 13px var(--font-ui);
    font-variant-numeric: tabular-nums;
  }
  .bookmark.marked {
    color: #c0392b;
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
  .offer {
    position: absolute;
    z-index: 15;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font: 600 14px var(--font-ui);
    box-shadow: var(--shadow-lift);
  }
  .zoom-controls {
    position: absolute;
    right: calc(12px + var(--safe-right));
    display: flex;
    gap: 8px;
    z-index: 12;
  }
  .zoom-controls .btn {
    box-shadow: var(--shadow-lift);
    background: var(--surface);
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
  @media (max-width: 900px) {
    .title,
    .save {
      display: none;
    }
    .left {
      max-width: none;
    }
    .tool {
      width: 40px;
    }
  }
</style>
