<script lang="ts">
  import { liveQuery } from 'dexie';
  import Sheet from '../components/Sheet.svelte';
  import { getDb } from '../../storage/db';
  import { addCard, deckForNotebook } from '../../storage/study';
  import { toasts } from '../stores/toast.svelte';
  import type { Id } from '../../model/types';

  let {
    front,
    notebookId,
    notebookTitle,
    pageId,
    onclose,
  }: { front: string; notebookId: Id; notebookTitle: string; pageId: Id | null; onclose: () => void } =
    $props();

  const decksQ = liveQuery(() => getDb().decks.toArray());
  let deckId = $state<Id | 'new'>('new');
  let backText = $state('');
  let busy = $state(false);

  $effect(() => {
    const own = $decksQ?.find((d) => d.notebookId === notebookId);
    if (own && deckId === 'new') deckId = own.id;
  });

  async function save() {
    busy = true;
    try {
      const id = deckId === 'new' ? (await deckForNotebook(notebookId, notebookTitle)).id : deckId;
      await addCard(id, front, backText.trim(), pageId);
      toasts.show('Lernkarte erstellt');
      onclose();
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title="Lernkarte erstellen" {onclose}>
  <div class="card">
    <span class="lbl">Vorderseite</span>
    <img src={front} alt="Vorderseite der Lernkarte" />
  </div>
  <label class="card">
    <span class="lbl">Rückseite (Antwort)</span>
    <textarea
      class="field"
      rows="3"
      bind:value={backText}
      placeholder="Antwort eintippen oder mit dem Pencil schreiben"></textarea>
  </label>
  <label class="row">
    <span class="lbl">Stapel</span>
    <select class="field" bind:value={deckId}>
      {#if !$decksQ?.some((d) => d.notebookId === notebookId)}
        <option value="new">{notebookTitle} (neu)</option>
      {/if}
      {#each $decksQ ?? [] as d (d.id)}
        <option value={d.id}>{d.name}</option>
      {/each}
    </select>
  </label>
  {#snippet footer()}
    <button class="btn" onclick={onclose}>Abbrechen</button>
    <button class="btn primary" onclick={() => void save()} disabled={busy}>Karte speichern</button>
  {/snippet}
</Sheet>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }
  .lbl {
    font: 600 13px var(--font-ui);
    color: var(--muted);
  }
  img {
    max-width: 100%;
    max-height: 220px;
    object-fit: contain;
    align-self: flex-start;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 0 0 1px var(--line);
  }
  textarea {
    min-height: 80px;
    padding: 10px 12px;
    resize: vertical;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .row select {
    flex: 1;
  }
</style>
