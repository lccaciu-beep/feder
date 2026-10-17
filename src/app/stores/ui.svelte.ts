// App-weiter UI-Zustand, der von mehreren Ansichten geöffnet werden kann.

class UiStore {
  settingsOpen = $state(false);
  /** Abschnitt, zu dem die Einstellungen beim Öffnen springen. */
  settingsSection = $state<string | null>(null);

  openSettings(section: string | null = null) {
    this.settingsSection = section;
    this.settingsOpen = true;
  }

  closeSettings() {
    this.settingsOpen = false;
    this.settingsSection = null;
  }
}

export const ui = new UiStore();
