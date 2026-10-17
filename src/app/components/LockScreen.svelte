<script lang="ts">
  // Sperrbildschirm mit Ziffernfeld (auch per Hardware-Tastatur bedienbar).
  import Icon from './Icon.svelte';
  import { verifyCode, type LockConfig } from '../../storage/lock';

  let { config, onunlock }: { config: LockConfig; onunlock: () => void } = $props();

  let code = $state('');
  let wrong = $state(false);
  let attempts = $state(0);
  let waitUntil = $state(0);
  let now = $state(Date.now());
  let checking = false;

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(t);
  });

  const blocked = $derived(waitUntil > now);

  async function press(d: string) {
    if (blocked || checking || code.length >= config.length) return;
    code += d;
    wrong = false;
    if (code.length === config.length) {
      checking = true;
      const ok = await verifyCode(code, config);
      checking = false;
      if (ok) {
        onunlock();
        return;
      }
      attempts++;
      wrong = true;
      code = '';
      if (attempts >= 5) {
        waitUntil = Date.now() + 30_000;
        attempts = 0;
      }
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (/^\d$/.test(e.key)) void press(e.key);
    else if (e.key === 'Backspace') code = code.slice(0, -1);
  }
</script>

<svelte:window {onkeydown} />

<div class="lock" role="dialog" aria-modal="true" aria-label="Feder ist gesperrt">
  <img src="{import.meta.env.BASE_URL}icons/icon-192.png" alt="" width="72" height="72" />
  <h1>Code eingeben</h1>
  <div class="dots" class:wrong aria-live="polite" aria-label="{code.length} von {config.length} Ziffern">
    {#each Array(config.length) as _, i (i)}
      <span class:filled={i < code.length}></span>
    {/each}
  </div>
  <p class="msg">
    {#if blocked}
      Zu viele Versuche. Bitte {Math.ceil((waitUntil - now) / 1000)} Sekunden warten.
    {:else if wrong}
      Falscher Code.
    {:else}
      &nbsp;
    {/if}
  </p>
  <div class="pad">
    {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
      <button onclick={() => void press(d)} disabled={blocked}>{d}</button>
    {/each}
    <span></span>
    <button onclick={() => void press('0')} disabled={blocked}>0</button>
    <button class="del" aria-label="Löschen" onclick={() => (code = code.slice(0, -1))}
      ><Icon name="back" /></button
    >
  </div>
</div>

<style>
  .lock {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: var(--bg);
    padding: var(--safe-top) 16px var(--safe-bottom);
  }
  img {
    border-radius: 18px;
  }
  h1 {
    margin: 4px 0 0;
    font-size: 22px;
    font-weight: 600;
  }
  .dots {
    display: flex;
    gap: 14px;
  }
  .dots span {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--ink);
  }
  .dots span.filled {
    background: var(--ink);
  }
  .dots.wrong {
    animation: shake 0.35s;
  }
  .dots.wrong span {
    border-color: var(--danger);
  }
  @keyframes shake {
    25% {
      transform: translateX(-8px);
    }
    75% {
      transform: translateX(8px);
    }
  }
  .msg {
    min-height: 1.4em;
    margin: 0;
    font: 14px var(--font-ui);
    color: var(--danger);
  }
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 76px);
    gap: 14px;
  }
  .pad button {
    width: 76px;
    height: 76px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow-cover);
    font: 500 28px var(--font-ui);
  }
  .pad button:disabled {
    opacity: 0.4;
  }
  .pad .del {
    background: transparent;
    box-shadow: none;
    display: grid;
    place-items: center;
  }
</style>
