// Versioniertes Datenformat. Jede Migration hebt einen Datensatz-Satz
// (Export/Backup) von Version n auf n+1. Die Dexie-Schema-Versionen in
// storage/db.ts nutzen dieselben Funktionen in ihren upgrade()-Hooks.

export const SCHEMA_VERSION = 2;

/** Tabellen als einfache Arrays, wie sie in Backups stehen. */
export type TableDump = Record<string, unknown[]>;

export type Migration = (data: TableDump) => TableDump;

/** migrations[n] hebt von Version n auf n+1. */
export const migrations: Record<number, Migration> = {
  // v1 → v2: neue Tabellen (Elemente, Lesezeichen, …); Formen bekommen Füll- und Deckkraft-Felder.
  1: (data) => ({
    ...data,
    items: (data.items ?? []).map((it) => upgradeItemV2(it as Record<string, unknown>)),
  }),
};

/** v1-Formen kannten fillOpacity/opacity noch nicht. */
export function upgradeItemV2(it: Record<string, unknown>): Record<string, unknown> {
  if (it.type !== 'shape') return it;
  return { fillOpacity: 0.25, opacity: 1, ...it };
}

export function migrate(data: TableDump, fromVersion: number, toVersion = SCHEMA_VERSION): TableDump {
  if (fromVersion > toVersion) {
    throw new Error(`Daten stammen aus einer neueren Feder-Version (${fromVersion} > ${toVersion}).`);
  }
  let current = data;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`Keine Migration von Version ${v} auf ${v + 1}.`);
    current = step(current);
  }
  return current;
}
