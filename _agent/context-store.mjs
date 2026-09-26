// The browser gets only an encrypted reference. Source notes and tool-history
// bodies remain on the server, bound to the same visitor/origin as the token.
export function createContextStore(storage, clock = Date.now) {
  return {
    async put(state, scope) {
      const serialized = JSON.stringify(state);
      if (new TextEncoder().encode(serialized).length > 340000) throw new Error('Context too large.');
      const ref = 'context:' + new Date(state.expires).toISOString().slice(0, 10) + ':' + crypto.randomUUID();
      const chunks = Math.ceil(serialized.length / 16000);
      await storage.transaction(async tx => {
        for (let index = 0; index < chunks; index++) await tx.put(ref + ':' + index, serialized.slice(index * 16000, (index + 1) * 16000));
        await tx.put(ref, { scope, expires: state.expires, chunks });
      });
      return ref;
    },
    async get(ref, scope) {
      if (!/^context:\d{4}-\d{2}-\d{2}:[a-f0-9-]{36}$/.test(ref || '')) throw new Error('Invalid context reference.');
      return storage.transaction(async tx => {
        const record = await tx.get(ref);
        if (!record || record.scope !== scope || record.expires < clock()) throw new Error('Context expired or unavailable.');
        let serialized = '';
        for (let index = 0; index < record.chunks; index++) {
          const chunk = await tx.get(ref + ':' + index);
          if (typeof chunk !== 'string') throw new Error('Incomplete context.');
          serialized += chunk;
        }
        return JSON.parse(serialized);
      });
    }
  };
}

export class AgentContext {
  constructor(ctx) { this.ctx = ctx; this.store = createContextStore(ctx.storage); }
  async fetch(request) {
    try {
      const operation = await request.json();
      if (typeof operation.scope !== 'string' || operation.scope.length > 300) throw new Error('Invalid scope.');
      if (operation.type === 'get') return Response.json({ ok: true, state: await this.store.get(operation.ref, operation.scope) });
      if (operation.type !== 'put' || !Number.isFinite(operation.state?.expires) || operation.state.expires > Date.now() + 86400000 + 10000) throw new Error('Invalid context.');
      const ref = await this.store.put(operation.state, operation.scope);
      if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 86400000);
      return Response.json({ ok: true, ref });
    } catch { return Response.json({ ok: false }); }
  }
  async alarm() {
    const today = new Date().toISOString().slice(0, 10);
    let cursor;
    do {
      const rows = await this.ctx.storage.list({ prefix: 'context:', limit: 128, ...(cursor ? { startAfter: cursor } : {}) });
      if (!rows.size) break;
      const expired = [...rows.keys()].filter(key => key.slice(8, 18) < today);
      if (expired.length) await this.ctx.storage.delete(expired);
      cursor = [...rows.keys()].at(-1);
      if (rows.size < 128) break;
    } while (true);
    if ((await this.ctx.storage.list({ prefix: 'context:', limit: 1 })).size) await this.ctx.storage.setAlarm(Date.now() + 86400000);
  }
}
