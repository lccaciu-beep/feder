<script lang="ts">
  // Lernen mit Karteikarten: Stapel wählen, fällige Karten abfragen.
  import { liveQuery } from 'dexie';
  import Icon from '../components/Icon.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import { getDb } from '../../storage/db';
  import { answer, deleteCard, deleteDeck, dueCards } from '../../storage/study';
  import type { Deck, Flashcard } from '../../model/types';
  import { router } from '../stores/router.svelte';

  const decksQ = liveQuery(() => getDb().decks.toArray());
  const cardsQ = liveQuery(() => getDb().cards.toArray());

  let session = $state.raw<{ deck: Deck; cards: Flashcard[]; index: number; known: number } | null>(null);
  let revealed = $state(false);
  let manage = $state.raw<Deck | null>(null);
  let confirmDelete = $state.raw<Deck | null>(null);

  const stats = $derived.by(() => {
    const now = Date.now();
    const m = new Map<string, { total: number; due: number }>();
    for (const c of $cardsQ ?? []) {
      const s = m.get(c.deckId) ?? { total: 0, due: 0 };
      s.total++;
      if (c.due <= now) s.due++;
      m.set(c.deckId, s);
    }
    return m;
  });

  async function start(deck: Deck) {
    const cards = await dueCards(deck.id);
    session = { deck, cards, index: 0, known: 0 };
    revealed = false;
  }

  async function rate(known: boolean) {
    if (!session) return;
    const card = session.cards[session.index]!;
    await answer(card, known);
    session = { ...session, index: session.index + 1, known: session.known + (known ? 1 : 0) };
    revealed = false;
  }

  function onkeydown(e: KeyboardEvent) {
    if (!session || session.index >= session.cards.length) return;
    if (e.key === ' ' && !revealed) {
      e.preventDefault();
      revealed = true;
    } else if (revealed && (e.key === '1' || e.key === 'ArrowLeft')) void rate(false);
    else if (revealed && (e.key === '2' || e.key === 'ArrowRight')) void rate(true);
  }
</script>

<svelte:window {onkeydown} />

{#if session}
  {@const card = session.cards[session.index]}
  <div class="session">
    <div class="top">
      <button class="btn" onclick={() => (session = null)}
        ><Icon name="back" size={18} /> {session.deck.name}</button
      >
      <span class="progress"
        >{Math.min(session.index + 1, session.cards.length)} / {session.cards.length}</span
      >
    </div>
    {#if !card}
      <div class="done">
        <h2>Fertig für heute</h2>
        <p>{session.known} von {session.cards.length} gewusst.</p>
        <button class="btn primary" onclick={() => (session = null)}>Zurück zu den Stapeln</button>
      </div>
    {:else}
      <div class="flash">
        <img src={card.front} alt="Frage" />
        {#if revealed}
          <div class="back">
            {#if card.back}<img src={card.back} alt="Antwort" />{/if}
            {#if card.backText}<p>{card.backText}</p>{/if}
            {#if !card.back && !card.backText}<p class="muted">Keine Antwort hinterlegt.</p>{/if}
          </div>
        {/if}
      </div>
      <div class="actions">
        {#if !revealed}
          <button class="btn primary big" onclick={() => (revealed = true)}>Antwort zeigen</button>
        {:else}
          <button class="btn big again" onclick={() => void rate(false)}>Nochmal</button>
          <button class="btn primary big" onclick={() => void rate(true)}>Gewusst</button>
        {/if}
      </div>
    {/if}
  </div>
{:else if manage}
  {@const deck = manage}
  <div class="manage">
    <div class="top">
      <button class="btn" onclick={() => (manage = null)}><Icon name="back" size={18} /> Stapel</button>
      <h2>{deck.name}</h2>
    </div>
    <div class="cards">
      {#each ($cardsQ ?? []).filter((c) => c.deckId === deck.id) as c (c.id)}
        <div class="mini">
          <img src={c.front} alt="" />
          <span>Fach {c.box}</span>
          <button class="icon-btn" aria-label="Karte löschen" onclick={() => void deleteCard(c.id)}
            ><Icon name="trash" size={18} /></button
          >
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="decks">
    {#if !$decksQ?.length}
      <p class="empty">
        Noch keine Lernkarten. Wähle im Notizbuch etwas mit dem Lasso aus und tippe auf ⋯ → „Lernkarte
        erstellen“.
      </p>
    {/if}
    {#each $decksQ ?? [] as d (d.id)}
      {@const s = stats.get(d.id) ?? { total: 0, due: 0 }}
      <div class="deck">
        <div class="info">
          <h3>{d.name}</h3>
          <span>{s.total} {s.total === 1 ? 'Karte' : 'Karten'}, {s.due} fällig</span>
        </div>
        {#if d.notebookId}
          <button
            class="icon-btn"
            aria-label="Notizbuch öffnen"
            onclick={() => router.go({ name: 'notebook', id: d.notebookId! })}
            ><Icon name="notebook" /></button
          >
        {/if}
        <button class="icon-btn" aria-label="Karten verwalten" onclick={() => (manage = d)}
          ><Icon name="list" /></button
        >
        <button class="icon-btn" aria-label="Stapel löschen" onclick={() => (confirmDelete = d)}
          ><Icon name="trash" /></button
        >
        <button class="btn primary" disabled={!s.due} onclick={() => void start(d)}>Lernen</button>
      </div>
    {/each}
  </div>
{/if}

{#if confirmDelete}
  {@const d = confirmDelete}
  <ConfirmDialog
    title="Stapel löschen?"
    text="„{d.name}“ wird mit allen Karten gelöscht."
    confirm="Stapel löschen"
    danger
    onclose={() => (confirmDelete = null)}
    onconfirm={() => void deleteDeck(d.id)}
  />
{/if}

<style>
  .decks,
  .manage {
    max-width: 760px;
  }
  .empty {
    color: var(--muted);
    font-family: var(--font-ui);
  }
  .deck {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    margin-bottom: 10px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-cover);
  }
  .info {
    flex: 1;
  }
  .info h3 {
    margin: 0;
    font-size: 17px;
  }
  .info span {
    font: 13px var(--font-ui);
    color: var(--muted);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  .top h2 {
    margin: 0;
    font-size: 20px;
  }
  .progress {
    margin-left: auto;
    font: 600 14px var(--font-ui);
    color: var(--muted);
  }
  .session {
    max-width: 820px;
    margin: 0 auto;
  }
  .flash {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    min-height: 300px;
    padding: 24px;
    border-radius: 20px;
    background: #fff;
    box-shadow: var(--shadow-cover);
  }
  .flash img {
    max-width: 100%;
    max-height: 40vh;
    object-fit: contain;
  }
  .back {
    width: 100%;
    padding-top: 18px;
    border-top: 2px dashed var(--line);
    text-align: center;
    color: #16203a;
    font-size: 20px;
  }
  .back p {
    margin: 0;
    white-space: pre-wrap;
  }
  .muted {
    color: var(--muted);
    font-size: 15px;
  }
  .actions {
    display: flex;
    justify-content: center;
    gap: 14px;
    margin-top: 20px;
  }
  .big {
    min-height: 52px;
    padding: 0 28px;
    font-size: 17px;
  }
  .again {
    color: var(--danger);
  }
  .done {
    text-align: center;
    padding: 40px 0;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
  .mini {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px;
    border-radius: 12px;
    background: var(--surface);
    font: 13px var(--font-ui);
  }
  .mini img {
    width: 100%;
    height: 100px;
    object-fit: contain;
    background: #fff;
  }
</style>
