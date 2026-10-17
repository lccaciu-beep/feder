// App-weiter UI-Zustand, der von mehreren Ansichten geöffnet werden kann.

class UiStore {
  settingsOpen = $state(false);
  /** Abschnitt, zu dem die Einstellungen beim Öffnen springen. */
  settingsSection = $state<string | null>(null);
  /** Suchbegriff, der beim Öffnen eines Notizbuchs markiert werden soll. */
  pendingSearch = $state<string | null>(null);
  /** Geöffnete Notizbücher als Tabs (pro Gerät gemerkt). */
  tabs = $state<{ id: string; title: string }[]>(loadTabs());

  openTab(id: string, title: string) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i >= 0) this.tabs[i] = { id, title };
    else this.tabs = [...this.tabs, { id, title }].slice(-8);
    saveTabs(this.tabs);
  }

  closeTab(id: string) {
    this.tabs = this.tabs.filter((t) => t.id !== id);
    saveTabs(this.tabs);
  }

  openSettings(section: string | null = null) {
    this.settingsSection = section;
    this.settingsOpen = true;
  }

  closeSettings() {
    this.settingsOpen = false;
    this.settingsSection = null;
  }
}

function loadTabs(): { id: string; title: string }[] {
  try {
    const raw = localStorage.getItem('feder-tabs');
    return raw ? (JSON.parse(raw) as { id: string; title: string }[]) : [];
  } catch {
    return [];
  }
}

function saveTabs(tabs: { id: string; title: string }[]) {
  try {
    localStorage.setItem('feder-tabs', JSON.stringify(tabs));
  } catch {
    /* privater Modus */
  }
}

export const ui = new UiStore();
