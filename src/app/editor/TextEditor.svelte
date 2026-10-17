<script lang="ts">
  // Echtes Textfeld über der Seite: Tastatur, Diktat und Scribble funktionieren hier.
  import type { Editor, TextEditInfo } from '../../engine/Editor';
  import { FONT_STACKS, LINE_HEIGHT } from '../../engine/render/items';

  let { editor, info }: { editor: Editor; info: TextEditInfo } = $props();

  let area = $state<HTMLTextAreaElement>();
  let value = $state('');
  let lastId = '';

  $effect(() => {
    if (info.item.id !== lastId) {
      lastId = info.item.id;
      value = info.item.text;
      queueMicrotask(() => area?.focus({ preventScroll: true }));
    }
  });

  const st = $derived(info.item.style);
  const fontSize = $derived(st.size * info.scale);

  function oninput() {
    editor.setEditingText(value);
    resize();
  }

  function resize() {
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.max(area.scrollHeight, fontSize * LINE_HEIGHT + 4)}px`;
  }

  $effect(() => {
    void fontSize;
    void info.screen.w;
    resize();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      editor.finishTextEdit();
    }
    e.stopPropagation();
  }
</script>

<div
  class="wrap"
  style:left="{info.screen.x}px"
  style:top="{info.screen.y}px"
  style:width="{info.screen.w}px"
  style:transform="rotate({info.item.rotation}rad)"
>
  <textarea
    bind:this={area}
    bind:value
    {oninput}
    {onkeydown}
    aria-label="Text"
    spellcheck="true"
    style:font-family={FONT_STACKS[st.font]}
    style:font-size="{fontSize}px"
    style:font-weight={st.bold ? 700 : 400}
    style:font-style={st.italic ? 'italic' : 'normal'}
    style:color={st.color}
    style:text-align={st.align}
    style:line-height={LINE_HEIGHT}
    style:padding-top="{2 * info.scale}px"></textarea>
  <button class="done" onpointerdown={(e) => e.preventDefault()} onclick={() => editor.finishTextEdit()}
    >Fertig</button
  >
</div>

<style>
  .wrap {
    position: absolute;
    transform-origin: center;
    z-index: 14;
  }
  textarea {
    display: block;
    width: 100%;
    min-height: 1em;
    margin: 0;
    padding: 0;
    border: 0;
    outline: 1.5px dashed var(--accent);
    outline-offset: 3px;
    background: transparent;
    resize: none;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    -webkit-user-select: text;
    user-select: text;
  }
  .done {
    position: absolute;
    right: -4px;
    top: -40px;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font: 600 13px var(--font-ui);
  }
</style>
