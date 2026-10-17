<script lang="ts" module>
  export interface MenuItem {
    label: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
    checked?: boolean;
    run: () => void;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  let { x, y, items, onclose }: { x: number; y: number; items: MenuItem[]; onclose: () => void } = $props();

  let el = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });

  $effect(() => {
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    pos = {
      left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
    };
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  });

  function pick(item: MenuItem) {
    item.run();
    onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="catcher" role="presentation" onpointerdown={onclose}></div>
<div class="menu" role="menu" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px">
  {#each items as item (item.label)}
    <button role="menuitem" class:danger={item.danger} disabled={item.disabled} onclick={() => pick(item)}>
      <span>{item.label}</span>
      {#if item.checked}<Icon name="check" size={18} />{:else if item.icon}<Icon
          name={item.icon}
          size={20}
        />{/if}
    </button>
  {/each}
</div>

<style>
  .catcher {
    position: fixed;
    inset: 0;
    z-index: 60;
  }
  .menu {
    position: fixed;
    z-index: 61;
    min-width: 230px;
    padding: 6px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow-lift);
    border: 1px solid var(--line);
  }
  button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    min-height: 42px;
    padding: 0 12px;
    border-radius: 9px;
    font-family: var(--font-ui);
    font-size: 15px;
    text-align: left;
  }
  button:hover:not(:disabled),
  button:focus-visible {
    background: var(--surface-2);
    outline: none;
  }
  button:disabled {
    opacity: 0.4;
  }
  .danger {
    color: var(--danger);
  }
</style>
