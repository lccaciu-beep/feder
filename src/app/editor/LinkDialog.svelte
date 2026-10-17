<script lang="ts">
  import { liveQuery } from 'dexie';
  import Sheet from '../components/Sheet.svelte';
  import { getDb } from '../../storage/db';
  import type { Id, LinkTarget } from '../../model/types';

  let {
    pageCount,
    pageIds,
    currentNotebook,
    onclose,
    oncreate,
  }: {
    pageCount: number;
    pageIds: readonly Id[];
    currentNotebook: Id;
    onclose: () => void;
    oncreate: (target: LinkTarget, label: string) => void;
  } = $props();

  type Kind = 'url' | 'page' | 'notebook';
  let kind = $state<Kind>('url');
  let url = $state('https://');
  let page = $state(1);
  let notebookId = $state<Id | ''>('');
  const notebooks = liveQuery(() =>
    getDb()
      .notebooks.filter((n) => !n.deletedAt && n.id !== currentNotebook)
      .toArray(),
  );

  const valid = $derived(
    kind === 'url'
      ? /^(https?:\/\/[^\s]+\.[^\s]+|mailto:\S+)$/i.test(url.trim())
      : kind === 'page'
        ? page >= 1 && page <= pageCount
        : !!notebookId,
  );

  function create() {
    if (!valid) return;
    if (kind === 'url') oncreate({ kind: 'url', url: url.trim() }, url.trim());
    else if (kind === 'page') oncreate({ kind: 'page', pageId: pageIds[page - 1]! }, `Seite ${page}`);
    else {
      const nb = $notebooks?.find((n) => n.id === notebookId);
      oncreate({ kind: 'notebook', notebookId: notebookId as Id }, nb?.title ?? 'Notizbuch');
    }
    onclose();
  }
</script>

<Sheet title="Link hinzufügen" {onclose}>
  <div class="seg">
    <button class:on={kind === 'url'} onclick={() => (kind = 'url')}>Webseite</button>
    <button class:on={kind === 'page'} onclick={() => (kind = 'page')}>Seite</button>
    <button class:on={kind === 'notebook'} onclick={() => (kind = 'notebook')}>Notizbuch</button>
  </div>
  <div class="field-row">
    {#if kind === 'url'}
      <input class="field" type="url" inputmode="url" bind:value={url} aria-label="Adresse" />
    {:else if kind === 'page'}
      <label
        >Seite <input class="field num" type="number" min="1" max={pageCount} bind:value={page} /> von {pageCount}</label
      >
    {:else}
      <select class="field" bind:value={notebookId} aria-label="Notizbuch">
        <option value="" disabled>Notizbuch wählen</option>
        {#each $notebooks ?? [] as n (n.id)}
          <option value={n.id}>{n.title}</option>
        {/each}
      </select>
    {/if}
  </div>
  <p class="hint">Der Link liegt über der Auswahl. Tippe ihn mit dem Finger an, um ihn zu öffnen.</p>
  {#snippet footer()}
    <button class="btn" onclick={onclose}>Abbrechen</button>
    <button class="btn primary" onclick={create} disabled={!valid}>Link anlegen</button>
  {/snippet}
</Sheet>

<style>
  .seg {
    display: inline-flex;
    padding: 3px;
    border-radius: 10px;
    background: var(--surface-2);
  }
  .seg button {
    min-height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    font: 500 14px var(--font-ui);
  }
  .seg button.on {
    background: var(--surface);
    box-shadow: 0 1px 2px rgba(22, 32, 58, 0.15);
  }
  .field-row {
    margin-top: 14px;
    font: 15px var(--font-ui);
  }
  .num {
    width: 90px;
    margin: 0 6px;
  }
  .hint {
    margin: 12px 0 0;
    font: 13px var(--font-ui);
    color: var(--muted);
  }
</style>
