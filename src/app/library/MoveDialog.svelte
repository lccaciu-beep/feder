<script lang="ts">
  import Sheet from '../components/Sheet.svelte';
  import Icon from '../components/Icon.svelte';
  import type { Folder, Id } from '../../model/types';

  let {
    folders,
    exclude,
    onclose,
    onpick,
  }: { folders: Folder[]; exclude: Set<Id>; onclose: () => void; onpick: (target: Id | null) => void } =
    $props();

  interface Row {
    folder: Folder;
    depth: number;
  }

  // Baum flach aufbauen; ausgeschlossene Ordner (und ihre Unterordner) fehlen.
  let rows = $derived.by(() => {
    const alive = folders.filter((f) => !f.deletedAt);
    const byParent = new Map<Id | null, Folder[]>();
    for (const f of alive) {
      const list = byParent.get(f.parentId) ?? [];
      list.push(f);
      byParent.set(f.parentId, list);
    }
    const out: Row[] = [];
    const walk = (parent: Id | null, depth: number) => {
      const list = (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      for (const f of list) {
        if (exclude.has(f.id)) continue;
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  function pick(id: Id | null) {
    onpick(id);
    onclose();
  }
</script>

<Sheet title="Verschieben nach" {onclose}>
  <ul>
    <li>
      <button onclick={() => pick(null)}><Icon name="notebook" size={20} /> Dokumente</button>
    </li>
    {#each rows as r (r.folder.id)}
      <li>
        <button style:padding-left="{14 + (r.depth + 1) * 20}px" onclick={() => pick(r.folder.id)}>
          <Icon name="folder" size={20} />
          {r.folder.name}
        </button>
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 46px;
    padding: 0 14px;
    border-radius: 10px;
    font: 500 15px var(--font-ui);
    text-align: left;
  }
  button:hover,
  button:focus-visible {
    background: var(--surface-2);
  }
</style>
