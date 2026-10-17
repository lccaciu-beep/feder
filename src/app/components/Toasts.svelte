<script lang="ts">
  import { toasts } from '../stores/toast.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast">
      <span>{t.text}</span>
      {#if t.action}
        <button
          class="act"
          onclick={() => {
            t.action!.run();
            toasts.dismiss(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      {#if t.sticky}
        <button class="act quiet" onclick={() => toasts.dismiss(t.id)}>Später</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(20px + var(--safe-bottom));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 80;
    width: max-content;
    max-width: calc(100vw - 32px);
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 10px 10px 18px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--surface);
    font: 500 15px/1.3 var(--font-ui);
    box-shadow: var(--shadow-lift);
  }
  .act {
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
  .act.quiet {
    background: transparent;
    color: inherit;
    opacity: 0.8;
  }
</style>
