<script lang="ts">
  // Dokument scannen: Foto aufnehmen oder wählen, Ecken setzen, entzerren, Filter wählen.
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { targetSize, warp, type Quad, type ScanFilter } from '../../io/scan/homography';

  let {
    title = 'Dokument scannen',
    confirm = 'Als Seite einfügen',
    onclose,
    onresult,
  }: {
    title?: string;
    confirm?: string;
    onclose: () => void;
    onresult: (blob: Blob, width: number, height: number) => void;
  } = $props();

  let cameraInput = $state<HTMLInputElement>();
  let libraryInput = $state<HTMLInputElement>();
  let source = $state.raw<ImageData | null>(null);
  let photoUrl = $state<string | null>(null);
  let quad = $state<Quad>([
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ]);
  let filter = $state<ScanFilter>('color');
  let result = $state.raw<{ url: string; blob: Blob; width: number; height: number } | null>(null);
  let busy = $state(false);

  const MAX_SRC = 2400;
  const STAGE_W = 640;
  const STAGE_H = 460;
  const k = $derived(source ? Math.min(STAGE_W / source.width, STAGE_H / source.height) : 1);

  async function load(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = true;
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, MAX_SRC / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s);
      c.height = Math.round(bmp.height * s);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      source = g.getImageData(0, 0, c.width, c.height);
      photoUrl = c.toDataURL('image/jpeg', 0.8);
      c.width = c.height = 0;
      const ix = source.width * 0.06;
      const iy = source.height * 0.06;
      quad = [
        [ix, iy],
        [source.width - ix, iy],
        [source.width - ix, source.height - iy],
        [ix, source.height - iy],
      ];
      result = null;
    } finally {
      busy = false;
    }
  }

  let drag: { i: number; id: number } | null = null;

  function down(e: PointerEvent, i: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { i, id: e.pointerId };
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id || !source) return;
    const stage = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(0, Math.min(source.width, (e.clientX - stage.left) / k));
    const y = Math.max(0, Math.min(source.height, (e.clientY - stage.top) / k));
    const next = [...quad] as Quad;
    next[drag.i] = [x, y];
    quad = next;
  }

  async function straighten() {
    if (!source) return;
    busy = true;
    await new Promise((r) => setTimeout(r, 30)); // UI kurz aktualisieren lassen
    try {
      let { width, height } = targetSize(quad);
      const s = Math.min(1, 2000 / Math.max(width, height));
      width = Math.max(10, Math.round(width * s));
      height = Math.max(10, Math.round(height * s));
      const px = warp(source, quad, width, height, filter);
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      c.getContext('2d')!.putImageData(
        new ImageData(px as Uint8ClampedArray<ArrayBuffer>, width, height),
        0,
        0,
      );
      const type = filter === 'bw' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.9));
      c.width = c.height = 0;
      if (!blob) return;
      if (result) URL.revokeObjectURL(result.url);
      result = { url: URL.createObjectURL(blob), blob, width, height };
    } finally {
      busy = false;
    }
  }

  $effect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  });

  const polygon = $derived(quad.map(([x, y]) => `${x * k},${y * k}`).join(' '));
</script>

<Sheet {title} {onclose} wide>
  <input bind:this={cameraInput} type="file" accept="image/*" capture="environment" hidden onchange={load} />
  <input bind:this={libraryInput} type="file" accept="image/*" hidden onchange={load} />

  {#if !source}
    <div class="start">
      <p>Fotografiere ein Blatt Papier. Danach ziehst du die vier Ecken auf die Kanten des Blatts.</p>
      <div class="actions">
        <button class="btn primary" onclick={() => cameraInput?.click()} disabled={busy}
          >Foto aufnehmen</button
        >
        <button class="btn" onclick={() => libraryInput?.click()} disabled={busy}>Bild wählen</button>
      </div>
    </div>
  {:else if !result}
    <p class="hint">Ziehe die Punkte auf die vier Ecken des Blatts.</p>
    <div
      class="stage"
      style:width="{source.width * k}px"
      style:height="{source.height * k}px"
      role="presentation"
      onpointermove={move}
      onpointerup={() => (drag = null)}
      onpointercancel={() => (drag = null)}
    >
      {#if photoUrl}<img src={photoUrl} alt="Aufgenommenes Foto" draggable="false" />{/if}
      <svg width={source.width * k} height={source.height * k} aria-hidden="true">
        <polygon points={polygon} />
      </svg>
      {#each quad as [x, y], i (i)}
        <span
          class="corner"
          style:left="{x * k}px"
          style:top="{y * k}px"
          role="slider"
          aria-label="Ecke {i + 1}"
          aria-valuenow={Math.round(x)}
          tabindex="0"
          onpointerdown={(e) => down(e, i)}
        ></span>
      {/each}
    </div>
  {:else}
    <div class="result">
      <img src={result.url} alt="Entzerrter Scan" />
    </div>
  {/if}

  {#if source}
    <div class="filters">
      <span>Darstellung</span>
      <div class="seg">
        {#each [['color', 'Farbe'], ['gray', 'Graustufen'], ['bw', 'Schwarzweiß']] as const as [id, label] (id)}
          <button
            class:on={filter === id}
            onclick={() => {
              filter = id;
              if (result) void straighten();
            }}>{label}</button
          >
        {/each}
      </div>
    </div>
  {/if}

  {#snippet footer()}
    {#if result}
      <button class="btn" onclick={() => (result = null)}
        ><Icon name="back" size={18} /> Ecken anpassen</button
      >
      <button
        class="btn primary"
        onclick={() => {
          onresult(result!.blob, result!.width, result!.height);
          onclose();
        }}>{confirm}</button
      >
    {:else if source}
      <button class="btn" onclick={() => cameraInput?.click()}>Neues Foto</button>
      <button class="btn primary" onclick={() => void straighten()} disabled={busy}
        >{busy ? 'Wird entzerrt …' : 'Entzerren'}</button
      >
    {:else}
      <button class="btn" onclick={onclose}>Abbrechen</button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .start {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 24px 0;
    text-align: center;
    font-family: var(--font-ui);
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .hint {
    margin: 0 0 10px;
    font: 14px var(--font-ui);
    color: var(--muted);
  }
  .stage {
    position: relative;
    margin: 0 auto;
    touch-action: none;
  }
  .stage img {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
  .stage svg {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }
  polygon {
    fill: rgba(39, 71, 201, 0.15);
    stroke: var(--accent);
    stroke-width: 2;
  }
  .corner {
    position: absolute;
    width: 30px;
    height: 30px;
    margin: -15px 0 0 -15px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.9);
    border: 3px solid var(--accent);
    touch-action: none;
  }
  .result {
    display: grid;
    place-items: center;
  }
  .result img {
    max-width: 100%;
    max-height: 460px;
    box-shadow: var(--shadow-cover);
  }
  .filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    font: 15px var(--font-ui);
    color: var(--muted);
  }
  .seg {
    display: inline-flex;
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
