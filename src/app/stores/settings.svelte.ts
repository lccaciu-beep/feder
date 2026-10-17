import { DEFAULT_SETTINGS, mergeSettings, type AppSettings } from '../../model/settings';
import { getDb } from '../../storage/db';

class SettingsStore {
  value = $state<AppSettings>(structuredClone(DEFAULT_SETTINGS));
  loaded = $state(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  async load() {
    const row = await getDb().settings.get('app');
    this.value = mergeSettings(row?.value as Partial<AppSettings> | undefined);
    this.loaded = true;
  }

  /** Änderung anwenden und gedrosselt speichern. */
  update(fn: (s: AppSettings) => void) {
    fn(this.value);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), 300);
  }

  async save() {
    this.timer = null;
    await getDb().settings.put({ key: 'app', value: $state.snapshot(this.value) });
  }

  snapshot(): AppSettings {
    return $state.snapshot(this.value) as AppSettings;
  }
}

export const settings = new SettingsStore();
