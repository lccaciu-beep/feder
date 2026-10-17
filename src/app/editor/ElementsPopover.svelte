<script lang="ts">
  import { liveQuery } from 'dexie';
  import Icon from '../components/Icon.svelte';
  import { getDb } from '../../storage/db';
  import { deleteElement } from '../../storage/elements';
  import type { ElementDef } from '../../model/types';

  let {
    x,
    y,
    onpick,
    onclose,
  }: { x: number; y: number; onpick: (def: ElementDef) => void; onclose: () => void } = $props();

  const q = liveQuery(() => getDb().elements.orderBy('createdAt').reverse().toArray());
  let editing = $state(false);
</script>

<div class="catcher" role="presentation" onpointerdown={onclose}></div>
<div
  class="pop"
  style:left="{Math.min(x, window.innerWidth - 340)}px"
  style:top="{y}px"
  role="dialog"
  aria-label="Elemente"
>
  <header>
    <h3>Elemente</h3>
    {#if $q?.length}
      <button class="link" onclick={() => (editing = !editing)}>{editing ? 'Fertig' : 'Bearbeiten'}</button>
    {/if}
  </header>
  {#if !$q?.length}
    <p class="empty">
      Wähle etwas mit dem Lasso aus und tippe auf ⋯ → „Als Element speichern“. Gespeicherte Elemente kannst du
      hier in jedes Notizbuch einfügen.
    </p>
  {:else}
    <div class="grid">
      {#each $q as el (el.id)}
        <div class="cell">
          <button
            class="el"
            aria-label="Element {el.name} einfügen"
            onclick={() => {
              if (editing) return;
              onpick(el);
              onclose();
            }}
          >
            {#if el.preview}<img src={el.preview} alt="" />{:else}<Icon name="sticker" />{/if}
            <span>{el.name}</span>
          </button>
          {#if editing}
            <button
              class="del"
              aria-label="Element {el.name} löschen"
              onclick={() => void deleteElement(el.id)}><Icon name="close" size={16} /></button
            >
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .catcher {
    position: fixed;
    inset: 0;
    z-index: 60;
  }
  .pop {
    position: fixed;
    z-index: 61;
    width: 330px;
    max-height: 60vh;
    overflow: auto;
    padding: 12px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-lift);
    border: 1px solid var(--line);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  h3 {
    margin: 0;
    font-size: 16px;
  }
  .link {
    color: var(--accent);
    font: 600 14px var(--font-ui);
  }
  .empty {
    margin: 0;
    font: 14px var(--font-ui);
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .cell {
    position: relative;
  }
  .el {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 8px 4px;
    border-radius: 12px;
    background: var(--surface-2);
    font: 12px var(--font-ui);
  }
  .el img {
    width: 80px;
    height: 60px;
    object-fit: contain;
  }
  .el span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .del {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--danger);
    color: #fff;
  }
</style>
