<script lang="ts">
  import Sheet from '../components/Sheet.svelte';
  import { clearLock, getLock, setLock, setLockDelay, verifyCode, type LockConfig } from '../../storage/lock';
  import { toasts } from '../stores/toast.svelte';

  let cfg = $state.raw<LockConfig | null>(null);
  let dialog = $state<'set' | 'off' | null>(null);
  let first = $state('');
  let second = $state('');
  let current = $state('');
  let error = $state('');

  async function refresh() {
    cfg = await getLock();
  }

  $effect(() => {
    void refresh();
  });

  function open(kind: 'set' | 'off') {
    first = second = current = error = '';
    dialog = kind;
  }

  async function saveCode() {
    if (!/^\d{4,6}$/.test(first)) return void (error = 'Bitte 4 bis 6 Ziffern eingeben.');
    if (first !== second) return void (error = 'Die beiden Eingaben stimmen nicht überein.');
    await setLock(first, cfg?.delayMin ?? 0);
    dialog = null;
    await refresh();
    toasts.show('App-Sperre ist aktiv');
  }

  async function turnOff() {
    if (!(await verifyCode(current, cfg))) return void (error = 'Falscher Code.');
    await clearLock();
    dialog = null;
    await refresh();
    toasts.show('App-Sperre ausgeschaltet');
  }

  const delays = [
    { v: 0, label: 'Sofort' },
    { v: 1, label: 'Nach 1 Minute' },
    { v: 5, label: 'Nach 5 Minuten' },
    { v: 15, label: 'Nach 15 Minuten' },
  ];
</script>

<p class="note">
  Fragt beim Öffnen nach einem Zahlencode. Das ist ein Sichtschutz: Die Notizen werden dadurch nicht
  verschlüsselt. Wer den Code vergisst, kann Feder nur durch Löschen der Website-Daten wieder öffnen – vorher
  ein Backup anlegen.
</p>
{#if cfg}
  <div class="row">
    <span>Sperren</span>
    <select
      class="field select"
      value={cfg.delayMin}
      onchange={async (e) => {
        await setLockDelay(Number((e.currentTarget as HTMLSelectElement).value));
        await refresh();
      }}
    >
      {#each delays as d (d.v)}
        <option value={d.v}>{d.label}</option>
      {/each}
    </select>
  </div>
  <div class="row">
    <button class="btn" onclick={() => open('set')}>Code ändern</button>
    <button class="btn danger" onclick={() => open('off')}>Sperre ausschalten</button>
  </div>
{:else}
  <div class="row">
    <span>App-Sperre ist aus</span>
    <button class="btn" onclick={() => open('set')}>Code festlegen</button>
  </div>
{/if}

{#if dialog === 'set'}
  <Sheet title="Code festlegen" onclose={() => (dialog = null)}>
    <div class="pins">
      <input
        class="field"
        type="password"
        inputmode="numeric"
        autocomplete="off"
        maxlength="6"
        placeholder="Neuer Code (4–6 Ziffern)"
        bind:value={first}
        aria-label="Neuer Code"
      />
      <input
        class="field"
        type="password"
        inputmode="numeric"
        autocomplete="off"
        maxlength="6"
        placeholder="Code wiederholen"
        bind:value={second}
        aria-label="Code wiederholen"
      />
      {#if error}<p class="err">{error}</p>{/if}
    </div>
    {#snippet footer()}
      <button class="btn" onclick={() => (dialog = null)}>Abbrechen</button>
      <button class="btn primary" onclick={() => void saveCode()}>Code sichern</button>
    {/snippet}
  </Sheet>
{:else if dialog === 'off'}
  <Sheet title="Sperre ausschalten" onclose={() => (dialog = null)}>
    <div class="pins">
      <input
        class="field"
        type="password"
        inputmode="numeric"
        autocomplete="off"
        maxlength="6"
        placeholder="Aktueller Code"
        bind:value={current}
        aria-label="Aktueller Code"
      />
      {#if error}<p class="err">{error}</p>{/if}
    </div>
    {#snippet footer()}
      <button class="btn" onclick={() => (dialog = null)}>Abbrechen</button>
      <button class="btn primary" onclick={() => void turnOff()}>Ausschalten</button>
    {/snippet}
  </Sheet>
{/if}

<style>
  .note {
    margin: 0 0 8px;
    font: 13px var(--font-ui);
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 48px;
    font: 15px var(--font-ui);
  }
  .select {
    width: auto;
    min-height: 40px;
  }
  .pins {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .err {
    margin: 0;
    color: var(--danger);
    font: 14px var(--font-ui);
  }
</style>
