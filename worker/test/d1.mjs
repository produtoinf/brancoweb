// Imitação do banco D1 da Cloudflare em cima do SQLite do Node (node:sqlite), só para os testes.
// Cobre o que o Worker usa: prepare().bind().first()/all()/run() e batch().
import { DatabaseSync } from 'node:sqlite';

export function novoD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    sql, args,
    bind(...a) { return stmt(sql, a); },
    async first() { const r = db.prepare(sql).get(...args); return r === undefined ? null : r; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() {
      const s = db.prepare(sql);
      if (/^\s*(SELECT|PRAGMA)|RETURNING/i.test(sql)) return { results: s.all(...args), meta: {} };
      const r = s.run(...args); return { results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
    },
  });
  return {
    prepare: sql => stmt(sql),
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await (/^\s*(SELECT|PRAGMA)|RETURNING/i.test(s.sql) ? s.all() : s.run())); return out; },
    _db: db,
  };
}
