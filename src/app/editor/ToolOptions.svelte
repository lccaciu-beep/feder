<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { settings } from '../stores/settings.svelte';
  import type { ToolId } from '../../engine/Editor';
  import type { DashStyle, PenKind } from '../../model/types';

  let { tool }: { tool: ToolId } = $props();

  const pens: { id: PenKind; label: string; icon: string }[] = [
    { id: 'fountain', label: 'Füller', icon: 'fountain' },
    { id: 'ballpoint', label: 'Kugelschreiber', icon: 'ballpoint' },
    { id: 'brush', label: 'Pinsel', icon: 'brush' },
    { id: 'pencil', label: 'Bleistift', icon: 'pencil' },
  ];
  const dashes: { id: DashStyle; label: string }[] = [
    { id: 'solid', label: 'Durchgezogen' },
    { id: 'dashed', label: 'Gestrichelt' },
    { id: 'dotted', label: 'Gepunktet' },
  ];

  let paletteFor = $state<{ slot: number; x: number; y: number } | null>(null);
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;

  const s = $derived(settings.value);
  const colors = $derived(tool === 'highlighter' ? s.highlighter.colors : s.pen.colors);
  const current = $derived(tool === 'highlighter' ? s.highlighter.color : s.pen.color);
  const widths = $derived(tool === 'highlighter' ? s.highlighter.widths : s.pen.widths);
  const width = $derived(tool === 'highlighter' ? s.highlighter.width : s.pen.width);

  function setColor(c: string) {
    settings.update((v) => {
      if (tool === 'highlighter') v.highlighter.color = c;
      else v.pen.color = c;
    });
  }

  function setWidth(w: number) {
    settings.update((v) => {
      if (tool === 'highlighter') v.highlighter.width = w;
      else v.pen.width = w;
    });
  }

  function replaceSlot(slot: number, c: string) {
    settings.update((v) => {
      const list = tool === 'highlighter' ? v.highlighter.colors : v.pen.colors;
      list[slot] = c;
      if (tool === 'highlighter') v.highlighter.color = c;
      else v.pen.color = c;
    });
  }

  // Langes Drücken auf eine Farbe öffnet die Palette, um diesen Platz zu ersetzen.
  function swatchDown(e: PointerEvent, slot: number) {
    longPressed = false;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pressTimer = setTimeout(() => {
      longPressed = true;
      paletteFor = { slot, x: r.left, y: r.bottom + 8 };
    }, 450);
  }

  function swatchUp(c: string) {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    if (!longPressed) setColor(c);
  }

  function swatchCancel() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }

  function addToPalette(c: string) {
    settings.update((v) => {
      if (!v.palette.includes(c)) v.palette = [...v.palette, c].slice(-20);
    });
  }

  /** Strichstärke als Punktgröße für die Anzeige (nach Rang der Voreinstellung). */
  function dot(i: number) {
    return 6 + i * 5;
  }
</script>

<div class="opts" role="toolbar" aria-label="Werkzeugoptionen">
  {#if tool === 'pen'}
    <div class="group">
      {#each pens as p (p.id)}
        <button
          class="icon-btn"
          class:on={s.pen.kind === p.id}
          aria-label={p.label}
          aria-pressed={s.pen.kind === p.id}
          onclick={() => settings.update((v) => (v.pen.kind = p.id))}><Icon name={p.icon} size={22} /></button
        >
      {/each}
    </div>
    <span class="sep"></span>
  {/if}

  {#if tool === 'pen' || tool === 'highlighter'}
    <div class="group">
      {#each colors as c, i (i)}
        <button
          class="swatch"
          class:on={c === current}
          class:hl={tool === 'highlighter'}
          style:--c={c}
          aria-label="Farbe {c}, lange drücken zum Ändern"
          aria-pressed={c === current}
          onpointerdown={(e) => swatchDown(e, i)}
          onpointerup={() => swatchUp(c)}
          onpointerleave={swatchCancel}
          onpointercancel={swatchCancel}
          onkeydown={(e) => e.key === 'Enter' && setColor(c)}
        ></button>
      {/each}
      <button
        class="icon-btn small"
        aria-label="Weitere Farben"
        onclick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          paletteFor = { slot: colors.indexOf(current), x: r.left, y: r.bottom + 8 };
        }}><Icon name="plus" size={18} /></button
      >
    </div>
    <span class="sep"></span>
    <div class="group">
      {#each widths as w, i (i)}
        <button
          class="width"
          class:on={Math.abs(w - width) < 0.001}
          aria-label="Stärke {i + 1}"
          aria-pressed={Math.abs(w - width) < 0.001}
          onclick={() => setWidth(w)}
        >
          <span style:width="{dot(i)}px" style:height="{dot(i)}px"></span>
        </button>
      {/each}
    </div>
  {/if}

  {#if tool === 'pen'}
    <span class="sep"></span>
    <div class="seg">
      {#each dashes as d (d.id)}
        <button
          class:on={s.pen.dash === d.id}
          aria-label={d.label}
          aria-pressed={s.pen.dash === d.id}
          onclick={() => settings.update((v) => (v.pen.dash = d.id))}
        >
          <svg width="28" height="10" aria-hidden="true">
            <line
              x1="3"
              y1="5"
              x2="25"
              y2="5"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-dasharray={d.id === 'dashed' ? '6 4.5' : d.id === 'dotted' ? '0.1 5' : undefined}
            />
          </svg>
        </button>
      {/each}
    </div>
  {/if}

  {#if tool === 'highlighter'}
    <span class="sep"></span>
    <button
      class="toggle"
      class:on={s.highlighter.straight}
      aria-pressed={s.highlighter.straight}
      onclick={() => settings.update((v) => (v.highlighter.straight = !v.highlighter.straight))}
      ><Icon name="straight" size={20} /> Gerade Linien</button
    >
  {/if}

  {#if tool === 'eraser'}
    <div class="seg">
      <button
        class:on={s.eraser.mode === 'stroke'}
        aria-pressed={s.eraser.mode === 'stroke'}
        onclick={() => settings.update((v) => (v.eraser.mode = 'stroke'))}>Ganzer Strich</button
      >
      <button
        class:on={s.eraser.mode === 'precision'}
        aria-pressed={s.eraser.mode === 'precision'}
        onclick={() => settings.update((v) => (v.eraser.mode = 'precision'))}>Präzise</button
      >
    </div>
    <span class="sep"></span>
    <div class="group">
      {#each s.eraser.sizes as size, i (i)}
        <button
          class="width"
          class:on={s.eraser.size === size}
          aria-label="Radierergröße {i + 1}"
          aria-pressed={s.eraser.size === size}
          onclick={() => settings.update((v) => (v.eraser.size = size))}
        >
          <span class="ring" style:width="{8 + i * 7}px" style:height="{8 + i * 7}px"></span>
        </button>
      {/each}
    </div>
    <span class="sep"></span>
    <button
      class="toggle"
      class:on={s.eraser.highlighterOnly}
      aria-pressed={s.eraser.highlighterOnly}
      onclick={() => settings.update((v) => (v.eraser.highlighterOnly = !v.eraser.highlighterOnly))}
      ><Icon name="highlighter" size={20} /> Nur Textmarker</button
    >
  {/if}
</div>

{#if paletteFor}
  {@const slot = paletteFor.slot}
  <div class="catcher" role="presentation" onpointerdown={() => (paletteFor = null)}></div>
  <div
    class="palette"
    style:left="{Math.min(paletteFor.x, window.innerWidth - 300)}px"
    style:top="{paletteFor.y}px"
  >
    <p>Farbe für Platz {slot + 1}</p>
    <div class="pal-grid">
      {#each s.palette as c (c)}
        <button
          class="swatch"
          style:--c={c}
          aria-label="Farbe {c}"
          onclick={() => {
            replaceSlot(slot, c);
            paletteFor = null;
          }}
        ></button>
      {/each}
    </div>
    <label class="custom">
      <span>Eigene Farbe</span>
      <input
        type="color"
        value={colors[slot] ?? current}
        onchange={(e) => {
          const c = (e.currentTarget as HTMLInputElement).value;
          addToPalette(c);
          replaceSlot(slot, c);
        }}
      />
    </label>
  </div>
{/if}

<style>
  .opts {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 16px;
    background: var(--bar);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow-lift);
    overflow-x: auto;
    max-width: calc(100vw - 24px);
    scrollbar-width: none;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .sep {
    width: 1px;
    height: 24px;
    background: var(--line);
    margin: 0 4px;
    flex: none;
  }
  .icon-btn.small {
    width: 36px;
    height: 36px;
  }
  .swatch {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex: none;
  }
  .swatch::after {
    content: '';
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
  .swatch.hl::after {
    opacity: 0.75;
  }
  .swatch.on::after {
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.15),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--c);
  }
  .width {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .width span {
    border-radius: 50%;
    background: var(--ink);
  }
  .width span.ring {
    background: transparent;
    border: 1.5px solid var(--ink);
  }
  .width.on {
    background: var(--accent-soft);
  }
  .width.on span {
    background: var(--accent);
  }
  .width.on span.ring {
    background: transparent;
    border-color: var(--accent);
  }
  .seg {
    display: inline-flex;
    padding: 3px;
    border-radius: 10px;
    background: var(--surface-2);
    flex: none;
  }
  .seg button {
    min-height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    font: 500 14px var(--font-ui);
    color: var(--muted);
  }
  .seg button.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(22, 32, 58, 0.15);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 10px;
    font: 500 14px var(--font-ui);
    color: var(--muted);
    white-space: nowrap;
  }
  .toggle.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .catcher {
    position: fixed;
    inset: 0;
    z-index: 60;
  }
  .palette {
    position: fixed;
    z-index: 61;
    width: 284px;
    padding: 14px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-lift);
    border: 1px solid var(--line);
  }
  .palette p {
    margin: 0 0 10px;
    font: 600 14px var(--font-ui);
  }
  .pal-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }
  .custom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    font: 500 14px var(--font-ui);
  }
  .custom input {
    width: 48px;
    height: 34px;
    border: 0;
    padding: 0;
    background: none;
  }
</style>
