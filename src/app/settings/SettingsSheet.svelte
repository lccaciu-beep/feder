<script lang="ts">
  import Sheet from '../components/Sheet.svelte';
  import { settings } from '../stores/settings.svelte';
  import { formatBytes, requestPersistence, storageInfo, type StorageInfo } from '../../storage/persist';
  import { getBlobStore } from '../../storage/blobstore';
  import { isStandalone } from '../../platform/safari';
  import type { PressureSetting, ThemeSetting } from '../../model/settings';

  let { onclose }: { onclose: () => void } = $props();

  let info = $state<StorageInfo | null>(null);
  let blobKind = $state<string>('…');

  async function refresh() {
    info = await storageInfo();
    blobKind = (await getBlobStore()).kind === 'opfs' ? 'Dateisystem (OPFS)' : 'Datenbank (IndexedDB)';
  }

  $effect(() => {
    void refresh();
  });

  async function askPersist() {
    await requestPersistence();
    await refresh();
  }

  const themes: { id: ThemeSetting; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Hell' },
    { id: 'dark', label: 'Dunkel' },
  ];
  const pressures: { id: PressureSetting; label: string; hint: string }[] = [
    {
      id: 'auto',
      label: 'Automatisch',
      hint: 'Echter Druck, wenn der Stift ihn liefert, sonst Geschwindigkeit',
    },
    { id: 'real', label: 'Druck', hint: 'Nur für Stifte mit Drucksensor (z. B. Apple Pencil 1)' },
    { id: 'velocity', label: 'Geschwindigkeit', hint: 'Schnelle Striche werden dünner' },
    { id: 'none', label: 'Gleichmäßig', hint: 'Immer dieselbe Strichstärke' },
  ];

  const s = $derived(settings.value);
  const usedPct = $derived(
    info?.usage != null && info.quota ? Math.min(100, (info.usage / info.quota) * 100) : 0,
  );
</script>

<Sheet title="Einstellungen" {onclose}>
  <section>
    <h3>Stift und Eingabe</h3>
    <div class="row col">
      <span>Strichstärke steuern über</span>
      <div class="seg">
        {#each pressures as p (p.id)}
          <button
            class:on={s.pressureMode === p.id}
            onclick={() => settings.update((v) => (v.pressureMode = p.id))}>{p.label}</button
          >
        {/each}
      </div>
      <small>{pressures.find((p) => p.id === s.pressureMode)?.hint}</small>
    </div>
    {#if s.pressureMode === 'auto' || s.pressureMode === 'velocity'}
      <label class="row col">
        <span>Empfindlichkeit für Geschwindigkeit</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={s.velocitySensitivity}
          oninput={(e) =>
            settings.update(
              (v) => (v.velocitySensitivity = Number((e.currentTarget as HTMLInputElement).value)),
            )}
        />
      </label>
    {/if}
    <label class="row">
      <span>Mit dem Finger zeichnen<small>Scrollen und Zoomen dann mit zwei Fingern</small></span>
      <input
        type="checkbox"
        checked={s.fingerDrawing}
        onchange={() => settings.update((v) => (v.fingerDrawing = !v.fingerDrawing))}
      />
    </label>
    <label class="row">
      <span>Zeichnen und halten zieht eine gerade Linie</span>
      <input
        type="checkbox"
        checked={s.holdToStraighten}
        onchange={() => settings.update((v) => (v.holdToStraighten = !v.holdToStraighten))}
      />
    </label>
    <label class="row">
      <span>Durchkritzeln löscht<small>Ein Zickzack über Striche entfernt sie</small></span>
      <input
        type="checkbox"
        checked={s.zigzagErase}
        onchange={() => settings.update((v) => (v.zigzagErase = !v.zigzagErase))}
      />
    </label>
    <label class="row">
      <span>Tippen mit zwei Fingern macht rückgängig<small>Mit drei Fingern wiederholen</small></span>
      <input
        type="checkbox"
        checked={s.tapGestures}
        onchange={() => settings.update((v) => (v.tapGestures = !v.tapGestures))}
      />
    </label>
  </section>

  <section>
    <h3>Darstellung</h3>
    <div class="row">
      <span>Design</span>
      <div class="seg">
        {#each themes as t (t.id)}
          <button class:on={s.theme === t.id} onclick={() => settings.update((v) => (v.theme = t.id))}
            >{t.label}</button
          >
        {/each}
      </div>
    </div>
    <div class="row">
      <span>Blättern</span>
      <div class="seg">
        <button
          class:on={s.scrollDirection === 'vertical'}
          onclick={() => settings.update((v) => (v.scrollDirection = 'vertical'))}>Vertikal</button
        >
        <button
          class:on={s.scrollDirection === 'horizontal'}
          onclick={() => settings.update((v) => (v.scrollDirection = 'horizontal'))}>Seitlich</button
        >
      </div>
    </div>
  </section>

  <section>
    <h3>Speicher</h3>
    <div class="meter" aria-hidden="true"><span style:width="{usedPct}%"></span></div>
    <p class="note">
      {formatBytes(info?.usage ?? null)} belegt von {formatBytes(info?.quota ?? null)} verfügbar. Große Dateien
      liegen im {blobKind}.
    </p>
    <div class="row">
      <span
        >Dauerhafter Speicher<small
          >{info?.persisted
            ? 'Aktiv: Safari löscht die Daten nicht automatisch.'
            : isStandalone()
              ? 'Noch nicht gewährt.'
              : 'Wird erst gewährt, wenn Feder auf dem Home-Bildschirm liegt.'}</small
        ></span
      >
      {#if !info?.persisted}
        <button class="btn" onclick={askPersist}>Anfragen</button>
      {/if}
    </div>
  </section>

  <section>
    <h3>Diagnose</h3>
    <label class="row">
      <span>Leistungsanzeige im Editor<small>Bildrate, Eingabe-Samples und erkannter Druck</small></span>
      <input
        type="checkbox"
        checked={s.debugOverlay}
        onchange={() => settings.update((v) => (v.debugOverlay = !v.debugOverlay))}
      />
    </label>
    <p class="note">Feder {__APP_VERSION__}</p>
  </section>
</Sheet>

<style>
  section + section {
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
  h3 {
    margin: 0 0 10px;
    font-size: 16px;
    font-weight: 600;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 48px;
    font: 15px var(--font-ui);
  }
  .row.col {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 0;
  }
  .row span {
    display: flex;
    flex-direction: column;
  }
  small {
    font-size: 13px;
    color: var(--muted);
  }
  input[type='checkbox'] {
    width: 24px;
    height: 24px;
    flex: none;
    accent-color: var(--accent);
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
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
  .meter {
    height: 8px;
    border-radius: 4px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    min-width: 2px;
    background: var(--accent);
  }
  .note {
    margin: 8px 0;
    font: 13px var(--font-ui);
    color: var(--muted);
  }
</style>
