<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    title,
    onclose,
    children,
    footer,
    wide = false,
  }: { title: string; onclose: () => void; children: Snippet; footer?: Snippet; wide?: boolean } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="scrim" role="presentation" onclick={onclose}></div>
<div class="sheet" class:wide role="dialog" aria-modal="true" aria-label={title}>
  <header>
    <h2>{title}</h2>
    <button class="icon-btn" onclick={onclose} aria-label="Schließen"><Icon name="close" /></button>
  </header>
  <div class="body">
    {@render children()}
  </div>
  {#if footer}
    <footer>{@render footer()}</footer>
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 50;
  }
  .sheet {
    position: fixed;
    z-index: 51;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px - var(--safe-top) - var(--safe-bottom));
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: 18px;
    box-shadow: var(--shadow-lift);
    overflow: hidden;
  }
  .sheet.wide {
    width: min(760px, calc(100vw - 32px));
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px 4px 22px;
  }
  h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .body {
    padding: 8px 22px 18px;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 18px calc(14px + var(--safe-bottom) * 0);
    border-top: 1px solid var(--line);
  }
</style>
