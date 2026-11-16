// mock-supabase.js — an in-memory stand-in for Supabase, used ONLY by tests.
// It implements the exact (narrow) query surface sync.js uses:
//   from(t).select('*').eq().gte().order().limit()   — pulls
//   from(t).select('*').in()                         — pull-before-push
//   from(t).upsert(rows, { onConflict })             — pushes
// and reproduces the server trigger: server_updated_at := now() on write,
// updated_at left alone when the client supplies it.
//
// Two "device" clients created from one server share state — that's what
// makes the two-device scenarios real.

export function createMockServer() {
  const tables = new Map(); // table name → Map(pkValue → row object, snake_case)

  // Fake server clock: strictly increasing so server_updated_at is ordered.
  let serverMs = Date.parse('2026-01-01T00:00:00Z');
  const serverNow = () => new Date(++serverMs).toISOString();

  const stats = { upsertCalls: 0, selectCalls: 0 };
  let failNextUpsert = false;

  function table(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  }

  function makeSelectBuilder(name) {
    const filters = { eq: [], in: [], gte: [] };
    let limit = Infinity;
    const builder = {
      eq(col, v) { filters.eq.push([col, v]); return builder; },
      in(col, vs) { filters.in.push([col, vs]); return builder; },
      gte(col, v) { filters.gte.push([col, v]); return builder; },
      order() { return builder; }, // we always sort by server_updated_at below
      limit(n) { limit = n; return builder; },
      // Thenable so `await builder` works exactly like supabase-js.
      then(resolve) {
        stats.selectCalls++;
        let rows = [...table(name).values()];
        for (const [col, v] of filters.eq) rows = rows.filter((r) => r[col] === v);
        for (const [col, vs] of filters.in) rows = rows.filter((r) => vs.includes(r[col]));
        for (const [col, v] of filters.gte) rows = rows.filter((r) => r[col] >= v);
        rows.sort((a, b) => String(a.server_updated_at).localeCompare(String(b.server_updated_at)));
        rows = rows.slice(0, limit).map((r) => structuredClone(r));
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  function client() {
    return {
      from(name) {
        return {
          select() { return makeSelectBuilder(name); },
          upsert(rows, { onConflict }) {
            return {
              then(resolve) {
                stats.upsertCalls++;
                if (failNextUpsert) {
                  failNextUpsert = false;
                  resolve({ data: null, error: { message: 'mock: upsert failed' } });
                  return;
                }
                for (const incoming of rows) {
                  const key = incoming[onConflict];
                  const existing = table(name).get(key) || {};
                  const row = { ...existing, ...structuredClone(incoming) };
                  // The "trigger": server time always, client updated_at kept.
                  row.server_updated_at = serverNow();
                  if (!row.updated_at) row.updated_at = row.server_updated_at;
                  table(name).set(key, row);
                }
                resolve({ data: null, error: null });
              },
            };
          },
        };
      },
    };
  }

  return {
    client,
    stats,
    failNextUpsert() { failNextUpsert = true; },
    count: (name) => table(name).size,
    liveCount: (name) => [...table(name).values()].filter((r) => !r.deleted_at).length,
    getRow: (name, id) => structuredClone(table(name).get(id) ?? null),
    allRows: (name) => [...table(name).values()].map((r) => structuredClone(r)),
  };
}
