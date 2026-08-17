/* =====================================================================
   Můj rozpočet — synchronizační Worker pro Cloudflare
   ---------------------------------------------------------------------
   Tenhle soubor se NEPOUŽÍVÁ v appce. Vloží se jednou do Cloudflare
   (Workers & Pages → tvůj Worker → Edit code) a běží tam samostatně.
   Postup krok za krokem je v SYNC-SETUP.md.

   Co to dělá: drží jeden JSON s tvým rozpočtem, přístupný přes dlouhý
   tajný „sync kód". Kód se nikdy neukládá tak, jak je — klíč v úložišti
   je jeho SHA-256 otisk.

   Pojistka proti ztrátě dat: při každém zápisu se předchozí verze odsune
   do „prev". Kdyby něco přepsalo data nesmyslem, jde se o krok vrátit
   přes GET /prev. Hlavní zálohou zůstává datový soubor na disku a
   export z appky — tohle je jen záchranná brzda navíc.
   ===================================================================== */

const CORS = {
  'Access-Control-Allow-Origin': '*',   // chrání tajný kód v hlavičce, ne origin
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Code',
  'Access-Control-Max-Age': '86400',
};

const json = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

async function keyFor(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    if (url.pathname === '/ping') return json({ ok: true });

    if (!env.ROZPOCET) return json({ error: 'chybí KV binding ROZPOCET' }, 500);

    // Kód chodí v hlavičce, ne v URL — ať se neukládá do logů a historie.
    const code = req.headers.get('X-Sync-Code') || '';
    if (code.length < 20) return json({ error: 'chybí nebo krátký sync kód' }, 401);
    const k = await keyFor(code);

    if (req.method === 'GET') {
      // seznam dnů, ze kterých je uložená verze (nejnovější první)
      if (url.pathname === '/list') {
        const l = await env.ROZPOCET.list({ prefix: 'snap:' + k + ':' });
        const days = l.keys.map(x => x.name.split(':').pop()).sort().reverse();
        return json({ days });
      }
      if (url.pathname.startsWith('/snap/')) {
        const val = await env.ROZPOCET.get('snap:' + k + ':' + url.pathname.slice(6));
        if (!val) return json({}, 404);
        return new Response(val, { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const which = url.pathname === '/prev' ? 'prev:' : 'cur:';
      const val = await env.ROZPOCET.get(which + k);
      if (!val) return json({}, 404);
      return new Response(val, { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (req.method === 'PUT') {
      const body = await req.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { return json({ error: 'nevalidní JSON' }, 400); }
      if (!parsed || typeof parsed.data !== 'object' || parsed.data === null)
        return json({ error: 'chybí pole data' }, 400);

      const cur = await env.ROZPOCET.get('cur:' + k);
      if (cur) await env.ROZPOCET.put('prev:' + k, cur);   // krok zpět
      await env.ROZPOCET.put('cur:' + k, body);

      // denní verze: klíč je datum, takže za den vzniká jedna (poslední uložení
      // toho dne). Drží se půl roku, pak se sama zahodí — historie zadarmo,
      // bez ručního zálohování a nezávisle na tomhle počítači.
      const day = new Date().toISOString().slice(0, 10);
      await env.ROZPOCET.put('snap:' + k + ':' + day, body, { expirationTtl: 60 * 60 * 24 * 180 });

      return json({ ok: true, mt: parsed.mt || null });
    }

    return json({ error: 'nepodporovaná metoda' }, 405);
  },
};
