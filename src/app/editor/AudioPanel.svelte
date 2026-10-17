<script lang="ts">
  // Aufnahmen eines Notizbuchs abspielen. Während der Wiedergabe erscheinen
  // Striche erst, wenn sie in der Aufnahme „geschrieben“ werden; ein Tipp auf
  // einen Strich springt zur passenden Stelle.
  import { liveQuery } from 'dexie';
  import Icon from '../components/Icon.svelte';
  import type { Editor } from '../../engine/Editor';
  import { getDb } from '../../storage/db';
  import { getBlobStore } from '../../storage/blobstore';
  import { clipForTime, deleteClip, formatDuration } from '../../audio/recorder';
  import type { AudioClip, Id } from '../../model/types';

  let { editor, notebookId, onclose }: { editor: Editor; notebookId: Id; onclose: () => void } = $props();

  const clipsQ = liveQuery(() => getDb().audio.where('notebookId').equals(notebookId).sortBy('startedAt'));
  let current = $state.raw<AudioClip | null>(null);
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let playing = $state(false);
  let position = $state(0);
  let raf = 0;

  async function load(clip: AudioClip, at = 0) {
    if (current?.id !== clip.id) {
      stop();
      const blob = await (await getBlobStore()).get(clip.blobId);
      if (!blob) return;
      url = URL.createObjectURL(blob);
      audio = new Audio(url);
      audio.onended = () => {
        playing = false;
        editor.setPlaybackTime(clip.startedAt + clip.duration);
      };
      current = clip;
    }
    if (audio) {
      audio.currentTime = Math.max(0, at / 1000);
      position = at;
      editor.setPlaybackTime(clip.startedAt + at);
    }
  }

  function tick() {
    if (audio && current) {
      position = audio.currentTime * 1000;
      editor.setPlaybackTime(current.startedAt + position);
    }
    if (playing) raf = requestAnimationFrame(tick);
  }

  async function play(clip: AudioClip, at?: number) {
    await load(clip, at ?? (current?.id === clip.id ? position : 0));
    if (!audio) return;
    await audio.play();
    playing = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    audio?.pause();
    playing = false;
    cancelAnimationFrame(raf);
  }

  function stop() {
    pause();
    audio = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    current = null;
  }

  // Tippt man während der Wiedergabe auf einen Strich, an diese Stelle springen.
  $effect(() =>
    editor.onEvent((e) => {
      if (e.type !== 'seek') return;
      const clip = clipForTime($clipsQ ?? [], e.t);
      if (clip) void play(clip, Math.max(0, e.t - clip.startedAt - 800));
    }),
  );

  $effect(() => () => {
    stop();
    editor.setPlaybackTime(null);
  });

  function fmtDate(t: number) {
    return new Date(t).toLocaleString('de-DE', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<div class="panel" role="region" aria-label="Aufnahmen">
  <header>
    <h3>Aufnahmen</h3>
    <span class="hint">Tippe auf einen Strich, um dorthin zu springen.</span>
    <button class="icon-btn" onclick={onclose} aria-label="Aufnahmen schließen"><Icon name="close" /></button>
  </header>
  {#if !$clipsQ?.length}
    <p class="empty">Noch keine Aufnahmen. Starte eine Aufnahme mit dem Mikrofon in der Werkzeugleiste.</p>
  {:else}
    <ul>
      {#each $clipsQ as c (c.id)}
        <li class:on={current?.id === c.id}>
          <button
            class="play"
            aria-label={current?.id === c.id && playing ? 'Pause' : 'Abspielen'}
            onclick={() => (current?.id === c.id && playing ? pause() : void play(c))}
          >
            <Icon name={current?.id === c.id && playing ? 'pause' : 'play'} size={20} />
          </button>
          <span class="when">{fmtDate(c.startedAt)}</span>
          {#if current?.id === c.id}
            <input
              type="range"
              min="0"
              max={c.duration}
              value={position}
              aria-label="Position"
              oninput={(e) => void load(c, Number((e.currentTarget as HTMLInputElement).value))}
            />
            <span class="time">{formatDuration(position)} / {formatDuration(c.duration)}</span>
          {:else}
            <span class="time">{formatDuration(c.duration)}</span>
          {/if}
          <button
            class="icon-btn small"
            aria-label="Aufnahme löschen"
            onclick={() => (current?.id === c.id && stop(), void deleteClip(c))}
            ><Icon name="trash" size={18} /></button
          >
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .panel {
    position: absolute;
    left: 50%;
    bottom: calc(12px + var(--safe-bottom));
    transform: translateX(-50%);
    width: min(620px, calc(100vw - 24px));
    max-height: 40vh;
    overflow: auto;
    padding: 6px 10px 10px;
    border-radius: 18px;
    background: var(--surface);
    box-shadow: var(--shadow-lift);
    z-index: 16;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  h3 {
    margin: 0 0 0 6px;
    font-size: 16px;
  }
  .hint {
    flex: 1;
    font: 12px var(--font-ui);
    color: var(--muted);
  }
  .empty {
    margin: 6px;
    font: 14px var(--font-ui);
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 6px;
    border-radius: 10px;
    font: 14px var(--font-ui);
  }
  li.on {
    background: var(--accent-soft);
  }
  .play {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    flex: none;
  }
  .when {
    white-space: nowrap;
  }
  input[type='range'] {
    flex: 1;
    accent-color: var(--accent);
  }
  .time {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    white-space: nowrap;
  }
  .icon-btn.small {
    width: 36px;
    height: 36px;
  }
</style>
