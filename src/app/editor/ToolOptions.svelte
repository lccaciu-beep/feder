<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { settings } from '../stores/settings.svelte';
  import type { Editor, ToolId } from '../../engine/Editor';
  import { FONT_LABELS } from '../../engine/render/items';
  import type { AppSettings } from '../../model/settings';
  import type { DashStyle, FontFamily, PenKind, TextStyle } from '../../model/types';

  let { tool, editor }: { tool: ToolId; editor: Editor | null } = $props();

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
  const TAPE_COLORS = ['#e8a33d', '#d9534f', '#3f8fd2', '#5aa469', '#8e6bbf'];
  const LASER_COLORS = ['#e5383b', '#2747c9', '#1f9d55', '#f59f00'];
  const TEXT_SIZES = [10, 12, 14, 18, 24, 32];
  const SHAPE_WIDTHS = [1, 1.6, 3];
  const TAPE_WIDTHS = [12, 18, 28];

  let paletteFor = $state<{ slot: number; x: number; y: number } | null>(null);
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;

  const s = $derived(settings.value);

  /** Schnellfarben, aktuelle Farbe und Setter je Werkzeug. */
  const colorModel = $derived.by(() => {
    switch (tool) {
      case 'highlighter':
        return { list: s.highlighter.colors, current: s.highlighter.color, editable: true };
      case 'shape':
        return { list: s.pen.colors, current: s.shape.color, editable: true };
      case 'text':
        return { list: s.pen.colors, current: s.text.color, editable: true };
      case 'tape':
        return { list: TAPE_COLORS, current: s.tape.color, editable: false };
      case 'laser':
        return { list: LASER_COLORS, current: s.laser.color, editable: false };
      default:
        return { list: s.pen.colors, current: s.pen.color, editable: true };
    }
  });

  function applyColor(v: AppSettings, c: string) {
    if (tool === 'highlighter') v.highlighter.color = c;
    else if (tool === 'shape') v.shape.color = c;
    else if (tool === 'text') v.text.color = c;
    else if (tool === 'tape') v.tape.color = c;
    else if (tool === 'laser') v.laser.color = c;
    else v.pen.color = c;
  }

  function setColor(c: string) {
    settings.update((v) => applyColor(v, c));
    if (tool === 'text') editor?.updateTextStyle({ color: c });
  }

  function replaceSlot(slot: number, c: string) {
    settings.update((v) => {
      const list = tool === 'highlighter' ? v.highlighter.colors : v.pen.colors;
      list[slot] = c;
      applyColor(v, c);
    });
    if (tool === 'text') editor?.updateTextStyle({ color: c });
  }

  function swatchDown(e: PointerEvent, slot: number) {
    longPressed = false;
    if (!colorModel.editable) return;
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

  function setText<K extends keyof TextStyle>(key: K, value: TextStyle[K]) {
    settings.update((v) => {
      (v.text as TextStyle)[key] = value;
    });
    editor?.updateTextStyle({ [key]: value } as Partial<TextStyle>);
  }

  const hasColors = $derived(tool !== 'eraser' && tool !== 'lasso');
  const widthModel = $derived.by(() => {
    if (tool === 'pen') return { list: s.pen.widths, current: s.pen.width };
    if (tool === 'highlighter') return { list: s.highlighter.widths, current: s.highlighter.width };
    if (tool === 'shape') return { list: SHAPE_WIDTHS, current: s.shape.width };
    if (tool === 'tape') return { list: TAPE_WIDTHS, current: s.tape.width };
    return null;
  });

  function setWidth(w: number) {
    settings.update((v) => {
      if (tool === 'pen') v.pen.width = w;
      else if (tool === 'highlighter') v.highlighter.width = w;
      else if (tool === 'shape') v.shape.width = w;
      else if (tool === 'tape') v.tape.width = w;
    });
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

  {#if tool === 'lasso'}
    <div class="seg">
      <button
        class:on={s.lasso.mode === 'free'}
        aria-pressed={s.lasso.mode === 'free'}
        onclick={() => settings.update((v) => (v.lasso.mode = 'free'))}>Freihand</button
      >
      <button
        class:on={s.lasso.mode === 'rect'}
        aria-pressed={s.lasso.mode === 'rect'}
        onclick={() => settings.update((v) => (v.lasso.mode = 'rect'))}>Rechteck</button
      >
    </div>
    <span class="sep"></span>
    <button class="toggle" onclick={() => editor?.selectAll()}
      ><Icon name="select" size={20} /> Alles auswählen</button
    >
    <button class="toggle" disabled={!editor?.canPaste} onclick={() => editor?.paste()}
      ><Icon name="paste" size={20} /> Einfügen</button
    >
  {/if}

  {#if tool === 'text'}
    <select
      class="font"
      aria-label="Schriftart"
      value={s.text.font}
      onchange={(e) => setText('font', (e.currentTarget as HTMLSelectElement).value as FontFamily)}
    >
      {#each Object.entries(FONT_LABELS) as [id, label] (id)}
        <option value={id}>{label}</option>
      {/each}
    </select>
    <select
      class="font"
      aria-label="Schriftgröße"
      value={s.text.size}
      onchange={(e) => setText('size', Number((e.currentTarget as HTMLSelectElement).value))}
    >
      {#each TEXT_SIZES as size (size)}
        <option value={size}>{size} pt</option>
      {/each}
    </select>
    <button
      class="icon-btn small"
      class:on={s.text.bold}
      aria-label="Fett"
      aria-pressed={s.text.bold}
      onclick={() => setText('bold', !s.text.bold)}><Icon name="bold" size={18} /></button
    >
    <button
      class="icon-btn small"
      class:on={s.text.italic}
      aria-label="Kursiv"
      aria-pressed={s.text.italic}
      onclick={() => setText('italic', !s.text.italic)}><Icon name="italic" size={18} /></button
    >
    {#each ['left', 'center', 'right'] as const as a (a)}
      <button
        class="icon-btn small"
        class:on={s.text.align === a}
        aria-label={a === 'left' ? 'Linksbündig' : a === 'center' ? 'Zentriert' : 'Rechtsbündig'}
        aria-pressed={s.text.align === a}
        onclick={() => setText('align', a)}><Icon name="align-{a}" size={18} /></button
      >
    {/each}
    <span class="sep"></span>
  {/if}

  {#if hasColors}
    <div class="group">
      {#each colorModel.list as c, i (i)}
        <button
          class="swatch"
          class:on={c === colorModel.current}
          class:hl={tool === 'highlighter'}
          style:--c={c}
          aria-label={colorModel.editable ? `Farbe ${c}, lange drücken zum Ändern` : `Farbe ${c}`}
          aria-pressed={c === colorModel.current}
          onpointerdown={(e) => swatchDown(e, i)}
          onpointerup={() => swatchUp(c)}
          onpointerleave={swatchCancel}
          onpointercancel={swatchCancel}
          onkeydown={(e) => e.key === 'Enter' && setColor(c)}
        ></button>
      {/each}
      {#if colorModel.editable}
        <button
          class="icon-btn small"
          aria-label="Weitere Farben"
          onclick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            paletteFor = {
              slot: Math.max(0, colorModel.list.indexOf(colorModel.current)),
              x: r.left,
              y: r.bottom + 8,
            };
          }}><Icon name="plus" size={18} /></button
        >
      {/if}
    </div>
  {/if}

  {#if widthModel}
    <span class="sep"></span>
    <div class="group">
      {#each widthModel.list as w, i (i)}
        <button
          class="width"
          class:on={Math.abs(w - widthModel.current) < 0.001}
          aria-label="Stärke {i + 1}"
          aria-pressed={Math.abs(w - widthModel.current) < 0.001}
          onclick={() => setWidth(w)}
        >
          <span style:width="{6 + i * 5}px" style:height="{6 + i * 5}px"></span>
        </button>
      {/each}
    </div>
  {/if}

  {#if tool === 'pen' || tool === 'shape'}
    <span class="sep"></span>
    <div class="seg">
      {#each dashes as d (d.id)}
        {@const on = (tool === 'pen' ? s.pen.dash : s.shape.dash) === d.id}
        <button
          class:on
          aria-label={d.label}
          aria-pressed={on}
          onclick={() =>
            settings.update((v) => {
              if (tool === 'pen') v.pen.dash = d.id;
              else v.shape.dash = d.id;
            })}
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

  {#if tool === 'shape'}
    <span class="sep"></span>
    <button
      class="toggle"
      class:on={s.shape.fill}
      aria-pressed={s.shape.fill}
      onclick={() => settings.update((v) => (v.shape.fill = !v.shape.fill))}
      ><Icon name="fill" size={20} /> Füllung</button
    >
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

  {#if tool === 'tape'}
    <span class="sep"></span>
    <span class="hint">Antippen deckt auf und zu</span>
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
        value={colorModel.list[slot] ?? colorModel.current}
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
    flex: none;
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
    flex: none;
  }
  .toggle.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .toggle:disabled {
    opacity: 0.4;
  }
  .font {
    min-height: 36px;
    padding: 0 8px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface);
    font: 500 14px var(--font-ui);
    flex: none;
  }
  .hint {
    font: 13px var(--font-ui);
    color: var(--muted);
    white-space: nowrap;
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
