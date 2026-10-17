<script lang="ts">
  import { liveQuery } from 'dexie';
  import Icon from '../components/Icon.svelte';
  import Menu, { type MenuItem } from '../components/Menu.svelte';
  import PromptDialog from '../components/PromptDialog.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import NotebookCover from './NotebookCover.svelte';
  import NewNotebookDialog from './NewNotebookDialog.svelte';
  import MoveDialog from './MoveDialog.svelte';
  import CoverDialog from './CoverDialog.svelte';
  import { press } from './press';
  import { router, type Route } from '../stores/router.svelte';
  import { settings } from '../stores/settings.svelte';
  import { toasts } from '../stores/toast.svelte';
  import { getDb } from '../../storage/db';
  import * as lib from '../../storage/library';
  import type { Folder, Id, Notebook } from '../../model/types';

  type LibRoute = Extract<Route, { name: 'library' }>;
  let { route, onsettings }: { route: LibRoute; onsettings: () => void } = $props();

  const db = getDb();
  const foldersQ = liveQuery(() => db.folders.toArray());
  const notebooksQ = liveQuery(() => db.notebooks.toArray());
  let folders = $derived<Folder[]>($foldersQ ?? []);
  let notebooks = $derived<Notebook[]>($notebooksQ ?? []);

  let query = $state('');
  let searchEl = $state<HTMLInputElement>();
  let selecting = $state(false);
  let selected = $state<Set<string>>(new Set());
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let dialog = $state<
    | { kind: 'new-notebook' }
    | { kind: 'new-folder' }
    | { kind: 'rename-folder'; folder: Folder }
    | { kind: 'rename-notebook'; notebook: Notebook }
    | { kind: 'move'; sel: lib.Selection }
    | { kind: 'cover'; notebook: Notebook }
    | { kind: 'confirm-delete'; sel: lib.Selection }
    | { kind: 'confirm-empty' }
    | null
  >(null);
  let drag = $state<{
    sel: lib.Selection;
    label: string;
    x: number;
    y: number;
    pointerId: number;
    target: Id | null | undefined;
  } | null>(null);

  const section = $derived(route.section);
  const folderId = $derived(route.section === 'docs' ? route.folderId : null);
  const aliveFolders = $derived(folders.filter((f) => !f.deletedAt));
  const folderMap = $derived(new Map(folders.map((f) => [f.id, f])));

  // Ein Element ist sichtbar, wenn weder es selbst noch ein Elternordner im Papierkorb liegt.
  function alive(parentId: Id | null): boolean {
    const seen = new Set<Id>();
    let p = parentId;
    while (p && !seen.has(p)) {
      seen.add(p);
      const f = folderMap.get(p);
      if (!f || f.deletedAt) return false;
      p = f.parentId;
    }
    return true;
  }

  const path = $derived.by(() => {
    const out: Folder[] = [];
    let p = folderId;
    const seen = new Set<Id>();
    while (p && !seen.has(p)) {
      seen.add(p);
      const f = folderMap.get(p);
      if (!f) break;
      out.unshift(f);
      p = f.parentId;
    }
    return out;
  });

  const norm = (s: string) =>
    s
      .toLocaleLowerCase('de')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');

  function sortItems<T extends { createdAt: number; updatedAt: number }>(
    list: T[],
    name: (t: T) => string,
  ): T[] {
    const s = settings.value.librarySort;
    return [...list].sort((a, b) =>
      s === 'name'
        ? name(a).localeCompare(name(b), 'de', { numeric: true })
        : s === 'created'
          ? b.createdAt - a.createdAt
          : b.updatedAt - a.updatedAt,
    );
  }

  const view = $derived.by(() => {
    const q = norm(query.trim());
    if (q) {
      return {
        folders: sortItems(
          aliveFolders.filter((f) => alive(f.parentId) && norm(f.name).includes(q)),
          (f) => f.name,
        ),
        notebooks: sortItems(
          notebooks.filter((n) => !n.deletedAt && alive(n.folderId) && norm(n.title).includes(q)),
          (n) => n.title,
        ),
      };
    }
    switch (section) {
      case 'docs':
        return {
          folders: sortItems(
            aliveFolders.filter((f) => f.parentId === folderId),
            (f) => f.name,
          ),
          notebooks: sortItems(
            notebooks.filter((n) => !n.deletedAt && n.folderId === folderId),
            (n) => n.title,
          ),
        };
      case 'recent':
        return {
          folders: [],
          notebooks: notebooks
            .filter((n) => !n.deletedAt && n.openedAt && alive(n.folderId))
            .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
            .slice(0, 40),
        };
      case 'favorites':
        return {
          folders: [],
          notebooks: sortItems(
            notebooks.filter((n) => !n.deletedAt && n.favorite && alive(n.folderId)),
            (n) => n.title,
          ),
        };
      case 'trash':
        return {
          folders: folders.filter((f) => f.deletedAt).sort((a, b) => b.deletedAt! - a.deletedAt!),
          notebooks: notebooks.filter((n) => n.deletedAt).sort((a, b) => b.deletedAt! - a.deletedAt!),
        };
    }
  });

  const heading = $derived(
    query.trim()
      ? 'Suche'
      : section === 'docs'
        ? (path.at(-1)?.name ?? 'Dokumente')
        : section === 'recent'
          ? 'Zuletzt geöffnet'
          : section === 'favorites'
            ? 'Favoriten'
            : 'Papierkorb',
  );

  function countIn(f: Folder): number {
    return (
      aliveFolders.filter((x) => x.parentId === f.id).length +
      notebooks.filter((n) => !n.deletedAt && n.folderId === f.id).length
    );
  }

  const thisYear = new Date().getFullYear();
  function fmtDate(t: number): string {
    const d = new Date(t);
    return d.toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'short',
      year: d.getFullYear() === thisYear ? undefined : 'numeric',
    });
  }

  // ---------- Aktionen ----------

  function openFolder(f: Folder) {
    query = '';
    router.go({ name: 'library', section: 'docs', folderId: f.id });
  }

  function openNotebook(n: Notebook) {
    router.go({ name: 'notebook', id: n.id });
  }

  function key(kind: 'f' | 'n', id: Id) {
    return `${kind}:${id}`;
  }

  function toggle(kind: 'f' | 'n', id: Id) {
    const k = key(kind, id);
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    selected = next;
  }

  function selection(): lib.Selection {
    const sel: lib.Selection = { folders: [], notebooks: [] };
    for (const k of selected) {
      const [kind, id] = k.split(':') as ['f' | 'n', string];
      (kind === 'f' ? sel.folders : sel.notebooks).push(id);
    }
    return sel;
  }

  function endSelecting() {
    selecting = false;
    selected = new Set();
  }

  async function guarded(fn: () => Promise<unknown>, done?: string) {
    try {
      await fn();
      if (done) toasts.show(done);
    } catch (err) {
      toasts.show(err instanceof Error ? err.message : String(err));
    }
  }

  async function trash(sel: lib.Selection) {
    await guarded(() => lib.moveToTrash(sel));
    const n = sel.folders.length + sel.notebooks.length;
    toasts.show(n === 1 ? 'In den Papierkorb gelegt' : `${n} Elemente in den Papierkorb gelegt`, {
      action: { label: 'Rückgängig', run: () => void lib.restoreFromTrash(sel) },
    });
  }

  async function moveTo(sel: lib.Selection, target: Id | null) {
    await guarded(async () => {
      for (const id of sel.folders) await lib.moveFolder(id, target);
      for (const id of sel.notebooks) await lib.moveNotebook(id, target);
    }, 'Verschoben');
  }

  async function duplicate(sel: lib.Selection) {
    await guarded(async () => {
      for (const id of sel.folders) await lib.duplicateFolder(id);
      for (const id of sel.notebooks) await lib.duplicateNotebook(id);
    }, 'Dupliziert');
  }

  function moveExclusions(sel: lib.Selection): Set<Id> {
    return new Set(sel.folders);
  }

  function folderMenu(f: Folder, x: number, y: number) {
    const sel = { folders: [f.id], notebooks: [] };
    menu = {
      x,
      y,
      items:
        section === 'trash'
          ? [
              {
                label: 'Wiederherstellen',
                icon: 'restore',
                run: () => void guarded(() => lib.restoreFromTrash(sel), 'Wiederhergestellt'),
              },
              {
                label: 'Endgültig löschen',
                icon: 'trash',
                danger: true,
                run: () => (dialog = { kind: 'confirm-delete', sel }),
              },
            ]
          : [
              {
                label: 'Umbenennen',
                icon: 'rename',
                run: () => (dialog = { kind: 'rename-folder', folder: f }),
              },
              { label: 'Duplizieren', icon: 'copy', run: () => void duplicate(sel) },
              { label: 'Verschieben …', icon: 'folder-move', run: () => (dialog = { kind: 'move', sel }) },
              { label: 'In den Papierkorb', icon: 'trash', danger: true, run: () => void trash(sel) },
            ],
    };
  }

  function notebookMenu(n: Notebook, x: number, y: number) {
    const sel = { folders: [], notebooks: [n.id] };
    menu = {
      x,
      y,
      items:
        section === 'trash'
          ? [
              {
                label: 'Wiederherstellen',
                icon: 'restore',
                run: () => void guarded(() => lib.restoreFromTrash(sel), 'Wiederhergestellt'),
              },
              {
                label: 'Endgültig löschen',
                icon: 'trash',
                danger: true,
                run: () => (dialog = { kind: 'confirm-delete', sel }),
              },
            ]
          : [
              {
                label: n.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten',
                icon: n.favorite ? 'star-filled' : 'star',
                run: () => void lib.setFavorite(n.id, !n.favorite),
              },
              {
                label: 'Umbenennen',
                icon: 'rename',
                run: () => (dialog = { kind: 'rename-notebook', notebook: n }),
              },
              {
                label: 'Cover ändern',
                icon: 'notebook',
                run: () => (dialog = { kind: 'cover', notebook: n }),
              },
              { label: 'Duplizieren', icon: 'copy', run: () => void duplicate(sel) },
              { label: 'Verschieben …', icon: 'folder-move', run: () => (dialog = { kind: 'move', sel }) },
              { label: 'In den Papierkorb', icon: 'trash', danger: true, run: () => void trash(sel) },
            ],
    };
  }

  function sortMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const set = (s: typeof settings.value.librarySort) => settings.update((v) => (v.librarySort = s));
    menu = {
      x: r.left,
      y: r.bottom + 6,
      items: [
        {
          label: 'Zuletzt geändert',
          checked: settings.value.librarySort === 'updated',
          run: () => set('updated'),
        },
        { label: 'Erstellt', checked: settings.value.librarySort === 'created', run: () => set('created') },
        { label: 'Name', checked: settings.value.librarySort === 'name', run: () => set('name') },
      ],
    };
  }

  function newMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = {
      x: r.right - 230,
      y: r.bottom + 6,
      items: [
        { label: 'Notizbuch', icon: 'notebook', run: () => (dialog = { kind: 'new-notebook' }) },
        { label: 'Ordner', icon: 'folder', run: () => (dialog = { kind: 'new-folder' }) },
      ],
    };
  }

  // ---------- Ziehen & Ablegen ----------

  function startDrag(sel: lib.Selection, label: string, e: PointerEvent) {
    drag = { sel, label, x: e.clientX, y: e.clientY, pointerId: e.pointerId, target: undefined };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    window.addEventListener('touchmove', preventTouch, { passive: false });
  }

  function preventTouch(e: TouchEvent) {
    e.preventDefault();
  }

  function dropTargetAt(x: number, y: number): Id | null | undefined {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
    if (!el) return undefined;
    const id = el.dataset.drop === 'root' ? null : el.dataset.drop!;
    if (id && drag?.sel.folders.includes(id)) return undefined;
    return id;
  }

  function onDragMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.target = dropTargetAt(e.clientX, e.clientY);
  }

  function onDragEnd(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    window.removeEventListener('touchmove', preventTouch);
    if (e.type === 'pointerup' && d.target !== undefined) void moveTo(d.sel, d.target);
  }

  function dragSelection(kind: 'f' | 'n', id: Id): lib.Selection {
    if (selecting && selected.has(key(kind, id))) return selection();
    return kind === 'f' ? { folders: [id], notebooks: [] } : { folders: [], notebooks: [id] };
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchEl?.focus();
    } else if (e.key === 'Escape' && selecting) endSelecting();
  }

  const tabs: { id: LibRoute['section']; label: string; icon: string }[] = [
    { id: 'docs', label: 'Dokumente', icon: 'notebook' },
    { id: 'recent', label: 'Zuletzt', icon: 'clock' },
    { id: 'favorites', label: 'Favoriten', icon: 'star' },
    { id: 'trash', label: 'Papierkorb', icon: 'trash' },
  ];

  function goTab(id: LibRoute['section']) {
    query = '';
    endSelecting();
    router.go(
      id === 'docs' ? { name: 'library', section: 'docs', folderId: null } : { name: 'library', section: id },
    );
  }

  const isEmpty = $derived(!view.folders.length && !view.notebooks.length);
  const listMode = $derived(settings.value.libraryView === 'list');
</script>

<svelte:window {onkeydown} />

<div class="library">
  <nav class="tabs" aria-label="Bereiche">
    {#each tabs as t (t.id)}
      <button
        class="tab"
        class:on={section === t.id && !query}
        data-drop={t.id === 'docs' ? 'root' : undefined}
        class:drop={drag && t.id === 'docs' && drag.target === null}
        onclick={() => goTab(t.id)}
      >
        <Icon name={t.icon} size={20} />
        <span>{t.label}</span>
      </button>
    {/each}
    <span class="spacer"></span>
    <button class="icon-btn" onclick={onsettings} aria-label="Einstellungen"><Icon name="settings" /></button>
  </nav>

  <header class="head">
    <div class="titles">
      {#if section === 'docs' && path.length && !query}
        <div class="crumbs">
          <button data-drop="root" class:drop={drag?.target === null} onclick={() => goTab('docs')}
            >Dokumente</button
          >
          {#each path.slice(0, -1) as f (f.id)}
            <span aria-hidden="true">/</span>
            <button data-drop={f.id} class:drop={drag?.target === f.id} onclick={() => openFolder(f)}
              >{f.name}</button
            >
          {/each}
        </div>
      {/if}
      <h1>{heading}</h1>
    </div>
    <div class="actions">
      <label class="search">
        <Icon name="search" size={18} />
        <input
          bind:this={searchEl}
          bind:value={query}
          type="search"
          placeholder="Suchen"
          aria-label="Notizbücher suchen"
        />
      </label>
      {#if section !== 'trash'}
        <button class="icon-btn" onclick={sortMenu} aria-label="Sortieren"><Icon name="sort" /></button>
      {/if}
      <button
        class="icon-btn"
        onclick={() => settings.update((v) => (v.libraryView = listMode ? 'grid' : 'list'))}
        aria-label={listMode ? 'Rasteransicht' : 'Listenansicht'}
        ><Icon name={listMode ? 'grid' : 'list'} /></button
      >
      {#if section === 'trash'}
        <button class="btn" disabled={isEmpty} onclick={() => (dialog = { kind: 'confirm-empty' })}
          >Papierkorb leeren</button
        >
      {:else}
        <button
          class="btn"
          class:on={selecting}
          onclick={() => (selecting ? endSelecting() : (selecting = true))}
        >
          {selecting ? 'Fertig' : 'Auswählen'}
        </button>
        {#if section === 'docs'}
          <button class="btn primary" onclick={newMenu}><Icon name="plus" size={20} /> Neu</button>
        {/if}
      {/if}
    </div>
  </header>

  <main class="content" class:list={listMode}>
    {#if isEmpty}
      <div class="empty">
        {#if query}
          <p>Nichts gefunden für „{query}“.</p>
        {:else if section === 'docs'}
          <p>{folderId ? 'Dieser Ordner ist leer.' : 'Noch keine Notizbücher. Leg dein erstes an.'}</p>
          <button class="btn primary" onclick={() => (dialog = { kind: 'new-notebook' })}
            >Neues Notizbuch</button
          >
        {:else if section === 'recent'}
          <p>Hier erscheinen Notizbücher, sobald du sie öffnest.</p>
        {:else if section === 'favorites'}
          <p>Markiere Notizbücher mit dem Stern, um sie hier zu sammeln.</p>
        {:else}
          <p>Der Papierkorb ist leer.</p>
        {/if}
      </div>
    {:else}
      <div class="grid">
        {#each view.folders as f (f.id)}
          {@const k = key('f', f.id)}
          <div
            class="tile folder-tile"
            class:sel={selected.has(k)}
            class:drop={drag?.target === f.id}
            data-drop={section === 'trash' ? undefined : f.id}
            role="button"
            tabindex="0"
            aria-label="Ordner {f.name}"
            use:press={{
              tap: (x, y) =>
                selecting ? toggle('f', f.id) : section === 'trash' ? folderMenu(f, x, y) : openFolder(f),
              menu: (x, y) => folderMenu(f, x, y),
              drag: section === 'trash' ? undefined : (e) => startDrag(dragSelection('f', f.id), f.name, e),
            }}
          >
            <div class="folder-shape" aria-hidden="true">
              <Icon name="folder" size={listMode ? 28 : 56} />
            </div>
            <div class="meta">
              <span class="name">{f.name}</span>
              <span class="sub">{countIn(f)} {countIn(f) === 1 ? 'Element' : 'Elemente'}</span>
            </div>
            {#if selecting}<span class="check" class:on={selected.has(k)}
                ><Icon name="check" size={16} /></span
              >{/if}
          </div>
        {/each}
        {#each view.notebooks as n (n.id)}
          {@const k = key('n', n.id)}
          <div
            class="tile nb-tile"
            class:sel={selected.has(k)}
            role="button"
            tabindex="0"
            aria-label="Notizbuch {n.title}"
            use:press={{
              tap: (x, y) =>
                selecting ? toggle('n', n.id) : section === 'trash' ? notebookMenu(n, x, y) : openNotebook(n),
              menu: (x, y) => notebookMenu(n, x, y),
              drag: section === 'trash' ? undefined : (e) => startDrag(dragSelection('n', n.id), n.title, e),
            }}
          >
            <NotebookCover title={n.title} cover={n.cover} width={listMode ? 40 : 148} />
            <div class="meta">
              <span class="name">
                {#if n.favorite}<span class="fav"><Icon name="star-filled" size={14} label="Favorit" /></span
                  >{/if}
                {n.title}
              </span>
              <span class="sub">
                {section === 'trash' ? `gelöscht ${fmtDate(n.deletedAt!)}` : fmtDate(n.updatedAt)}
                {#if listMode}, {n.pageIds.length} {n.pageIds.length === 1 ? 'Seite' : 'Seiten'}{/if}
              </span>
            </div>
            {#if selecting}<span class="check" class:on={selected.has(k)}
                ><Icon name="check" size={16} /></span
              >{/if}
          </div>
        {/each}
      </div>
    {/if}
  </main>

  {#if selecting}
    {@const sel = selection()}
    {@const none = !selected.size}
    <div class="selbar" role="toolbar" aria-label="Auswahl">
      <span class="count">{selected.size} ausgewählt</span>
      <button class="btn" disabled={none} onclick={() => (dialog = { kind: 'move', sel })}
        ><Icon name="folder-move" size={20} /> Verschieben</button
      >
      <button class="btn" disabled={none} onclick={() => void duplicate(sel).then(endSelecting)}
        ><Icon name="copy" size={20} /> Duplizieren</button
      >
      <button
        class="btn"
        disabled={!sel.notebooks.length}
        onclick={() =>
          void Promise.all(sel.notebooks.map((id) => lib.setFavorite(id, true))).then(endSelecting)}
        ><Icon name="star" size={20} /> Favorit</button
      >
      <button class="btn danger" disabled={none} onclick={() => void trash(sel).then(endSelecting)}
        ><Icon name="trash" size={20} /> Löschen</button
      >
    </div>
  {/if}
</div>

{#if drag}
  <div class="ghost" style:left="{drag.x}px" style:top="{drag.y}px" aria-hidden="true">
    {drag.sel.folders.length + drag.sel.notebooks.length > 1
      ? `${drag.sel.folders.length + drag.sel.notebooks.length} Elemente`
      : drag.label}
  </div>
{/if}

{#if menu}
  <Menu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

{#if dialog?.kind === 'new-notebook'}
  <NewNotebookDialog
    {folderId}
    onclose={() => (dialog = null)}
    oncreated={(id) => {
      dialog = null;
      router.go({ name: 'notebook', id });
    }}
  />
{:else if dialog?.kind === 'new-folder'}
  <PromptDialog
    title="Neuer Ordner"
    confirm="Ordner anlegen"
    onclose={() => (dialog = null)}
    onsubmit={(name) => void guarded(() => lib.createFolder(name, folderId))}
  />
{:else if dialog?.kind === 'rename-folder'}
  {@const f = dialog.folder}
  <PromptDialog
    title="Ordner umbenennen"
    value={f.name}
    onclose={() => (dialog = null)}
    onsubmit={(name) => void guarded(() => lib.renameFolder(f.id, name))}
  />
{:else if dialog?.kind === 'rename-notebook'}
  {@const n = dialog.notebook}
  <PromptDialog
    title="Notizbuch umbenennen"
    value={n.title}
    onclose={() => (dialog = null)}
    onsubmit={(title) => void guarded(() => lib.renameNotebook(n.id, title))}
  />
{:else if dialog?.kind === 'move'}
  {@const sel = dialog.sel}
  <MoveDialog
    folders={aliveFolders}
    exclude={moveExclusions(sel)}
    onclose={() => (dialog = null)}
    onpick={(target) => void moveTo(sel, target).then(endSelecting)}
  />
{:else if dialog?.kind === 'cover'}
  <CoverDialog notebook={dialog.notebook} onclose={() => (dialog = null)} />
{:else if dialog?.kind === 'confirm-delete'}
  {@const sel = dialog.sel}
  <ConfirmDialog
    title="Endgültig löschen?"
    text="Die ausgewählten Elemente werden mit allen Seiten gelöscht. Das lässt sich nicht rückgängig machen."
    confirm="Endgültig löschen"
    danger
    onclose={() => (dialog = null)}
    onconfirm={() => void guarded(() => lib.deletePermanently(sel), 'Gelöscht')}
  />
{:else if dialog?.kind === 'confirm-empty'}
  <ConfirmDialog
    title="Papierkorb leeren?"
    text="Alle Notizbücher und Ordner im Papierkorb werden endgültig gelöscht."
    confirm="Papierkorb leeren"
    danger
    onclose={() => (dialog = null)}
    onconfirm={() => void guarded(() => lib.emptyTrash(), 'Papierkorb geleert')}
  />
{/if}

<style>
  .library {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: var(--safe-top) var(--safe-right) 0 var(--safe-left);
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 20px 0;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 999px;
    font: 500 15px var(--font-ui);
    color: var(--muted);
  }
  .tab.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(22, 32, 58, 0.1);
  }
  .tab.drop,
  .crumbs button.drop {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 18px 28px 12px;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 500 14px var(--font-ui);
    color: var(--muted);
  }
  .crumbs button {
    padding: 4px 6px;
    border-radius: 6px;
  }
  h1 {
    margin: 2px 0 0;
    font-size: 34px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--muted);
  }
  .search input {
    width: 160px;
    border: 0;
    outline: none;
    background: transparent;
    font-size: 16px;
  }
  .btn.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .content {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 12px 28px calc(110px + var(--safe-bottom));
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(164px, 1fr));
    gap: 30px 22px;
  }
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 14px;
    cursor: pointer;
    transition: transform 0.15s ease;
  }
  .tile:global(.lifted) {
    transform: scale(1.05);
  }
  .tile.sel,
  .tile.drop {
    background: var(--accent-soft);
  }
  .tile:focus-visible {
    outline: 2px solid var(--accent);
  }
  .folder-shape {
    display: grid;
    place-items: center;
    width: 148px;
    height: 195px;
    color: var(--accent);
  }
  .folder-shape :global(svg) {
    width: 92px;
    height: 92px;
    stroke-width: 1.2;
  }
  .meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    text-align: center;
  }
  .name {
    font-weight: 600;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .fav {
    color: #c49a2c;
    vertical-align: -1px;
  }
  .sub {
    font: 13px var(--font-ui);
    color: var(--muted);
  }
  .check {
    position: absolute;
    top: 12px;
    right: 12px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--line);
    color: transparent;
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  /* Listenansicht */
  .list .grid {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .list .tile {
    flex-direction: row;
    justify-content: flex-start;
    gap: 16px;
    padding: 8px 12px;
  }
  .list .folder-shape {
    width: 40px;
    height: 53px;
  }
  .list .folder-shape :global(svg) {
    width: 32px;
    height: 32px;
  }
  .list .meta {
    align-items: flex-start;
    text-align: left;
  }
  .list .check {
    top: 50%;
    transform: translateY(-50%);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    margin-top: 12vh;
    color: var(--muted);
    font-family: var(--font-ui);
  }
  .selbar {
    position: fixed;
    left: 50%;
    bottom: calc(18px + var(--safe-bottom));
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 18px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow-lift);
    max-width: calc(100vw - 24px);
    overflow-x: auto;
  }
  .count {
    font: 600 14px var(--font-ui);
    white-space: nowrap;
    margin-right: 6px;
  }
  .ghost {
    position: fixed;
    z-index: 90;
    transform: translate(-50%, -130%);
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font: 600 14px var(--font-ui);
    pointer-events: none;
    box-shadow: var(--shadow-lift);
    white-space: nowrap;
  }
  @media (max-width: 700px) {
    .head {
      padding: 14px 16px 8px;
    }
    .content {
      padding: 8px 16px calc(110px + var(--safe-bottom));
    }
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    }
    .search input {
      width: 110px;
    }
  }
</style>
