import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function sqliteStorage(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const get = db.prepare('SELECT value FROM kv WHERE key = ?');
  const put = db.prepare('INSERT INTO kv VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  // Serialize async transaction callbacks in this process; SQLite protects other processes.
  let tail = Promise.resolve();
  return {
    transaction(callback) {
      const task = tail.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await callback({ get: async key => { const row = get.get(key); return row && JSON.parse(row.value); }, put: async (key, value) => { put.run(key, JSON.stringify(value)); } });
          db.prepare("DELETE FROM kv WHERE key LIKE 'quota:%' AND key < ?").run('quota:' + new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
          db.exec('COMMIT'); return result;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      });
      tail = task.catch(() => {});
      return task;
    },
    close() { db.close(); }
  };
}
