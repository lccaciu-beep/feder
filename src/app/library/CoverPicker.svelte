<script lang="ts">
  import { COVER_COLORS } from '../../model/paper';
  import type { CoverSpec } from '../../model/types';

  let { cover = $bindable() }: { cover: CoverSpec } = $props();

  const patterns: { id: CoverSpec['pattern']; label: string }[] = [
    { id: 'plain', label: 'Glatt' },
    { id: 'linen', label: 'Leinen' },
    { id: 'stripe', label: 'Streifen' },
    { id: 'dots', label: 'Punkte' },
  ];
</script>

<div class="cp">
  <div class="colors">
    {#each COVER_COLORS as c (c)}
      <button
        class="sw"
        class:on={cover.color === c}
        style:background={c}
        aria-label="Coverfarbe {c}"
        aria-pressed={cover.color === c}
        onclick={() => (cover.color = c)}
      ></button>
    {/each}
  </div>
  <div class="seg">
    {#each patterns as p (p.id)}
      <button class:on={cover.pattern === p.id} onclick={() => (cover.pattern = p.id)}>{p.label}</button>
    {/each}
  </div>
</div>

<style>
  .cp {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .colors {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .sw {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  }
  .sw.on {
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.12),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    align-self: flex-start;
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
</style>
