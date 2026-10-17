<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import type { Editor } from '../../engine/Editor';
  import type { NotebookDoc } from '../../engine/doc/NotebookDoc';
  import { hitLabel, searchContent, type Hit } from '../../search/query';
  import { highlightsFor } from '../../search/highlight';
  import type { Id, Rect } from '../../model/types';

  let {
    doc,
    editor,
    initial = '',
    onclose,
  }: { doc: NotebookDoc; editor: Editor; initial?: string; onclose: () => void } = $props();

  let query = $state(untrack(() => initial));
  let hits = $state.raw<Hit[]>([]);
  let busy = $state(false);
  let input = $state<HTMLInputElement>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;

  const tags = $derived.by(() => {
    const set = new Set<string>();
    for (const id of doc.pageIds) for (const t of doc.pages.get(id)?.tags ?? []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b, 'de'));
  });

  $effect(() => {
    input?.focus();
    return () => editor.setHighlights(new Map());
  });

  $effect(() => {
    const q = query;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(q), 250);
  });

  async function run(q: string) {
    const my = ++seq;
    if (q.trim().length < 2) {
      hits = [];
      editor.setHighlights(new Map());
      return;
    }
    busy = true;
    await doc.flushReindex();
    const found = await searchContent(q, { notebookId: doc.id });
    if (my !== seq) return;
    hits = found;
    busy = false;
    // Treffer der ersten Seiten sofort markieren
    const map = new Map<Id, Rect[]>();
    for (const pageId of [...new Set(found.map((h) => h.pageId))].slice(0, 30)) {
      const rects = await highlightsFor(doc, pageId, q);
      if (my !== seq) return;
      if (rects.length) map.set(pageId, rects);
    }
    editor.setHighlights(map);
  }

  function open(h: Hit) {
    editor.goToPage(h.pageIndex);
  }
</script>

<aside class="panel" aria-label="Suche im Notizbuch">
  <header>
    <label class="search">
      <Icon name="search" size={18} />
      <input
        bind:this={input}
        bind:value={query}
        type="search"
        placeholder="Im Notizbuch suchen"
        aria-label="Im Notizbuch suchen"
      />
    </label>
    <button class="icon-btn" onclick={onclose} aria-label="Suche schließen"><Icon name="close" /></button>
  </header>

  {#if tags.length}
    <div class="tags" aria-label="Stichworte">
      {#each tags as t (t)}
        <button class="tag" onclick={() => (query = t)}><Icon name="tag" size={14} /> {t}</button>
      {/each}
    </div>
  {/if}

  <div class="list">
    {#if query.trim().length < 2}
      <p class="hint">Gesucht wird in PDF-Text, Textfeldern, Stichworten, Lesezeichen und der Gliederung.</p>
    {:else if busy && !hits.length}
      <p class="hint">Suche läuft …</p>
    {:else if !hits.length}
      <p class="hint">Keine Treffer für „{query}“.</p>
    {:else}
      <p class="count">{hits.length === 1 ? '1 Treffer' : `${hits.length} Treffer`}</p>
      {#each hits as h, i (i)}
        <button class="hit" onclick={() => open(h)}>
          <span class="where">Seite {h.pageIndex + 1}, {hitLabel(h.kind)}</span>
          <span class="snip">{h.snippet}</span>
        </button>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .panel {
    position: absolute;
    right: calc(10px + var(--safe-right));
    top: calc(var(--toolbar-h, 64px) + 8px);
    bottom: calc(10px + var(--safe-bottom));
    width: min(340px, calc(100vw - 20px));
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: 18px;
    box-shadow: var(--shadow-lift);
    z-index: 20;
  }
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 4px 8px 10px;
  }
  .search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 10px;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    font-size: 16px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 12px 8px;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font: 500 13px var(--font-ui);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 12px;
  }
  .hint,
  .count {
    margin: 8px;
    font: 14px var(--font-ui);
    color: var(--muted);
  }
  .hit {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 10px;
    border-radius: 10px;
    text-align: left;
  }
  .hit:hover,
  .hit:focus-visible {
    background: var(--surface-2);
  }
  .where {
    font: 600 13px var(--font-ui);
    color: var(--accent);
  }
  .snip {
    font: 14px/1.35 var(--font-ui);
  }
</style>
