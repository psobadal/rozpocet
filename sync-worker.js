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
      /* Kurzy akcií a ETF. Prohlížeč si je u burzy vyzvednout nemůže —
         zdroj neposílá CORS hlavičky — takže to udělá Worker za něj.
         Chodí sem jen symboly, žádná data o penězích. Sync kód se
         vyžaduje výš, ať Worker neslouží cizím lidem jako proxy. */
      if (url.pathname === '/px') {
        // Kontrola kódu výš pozná jen délku, což by proxy otevřelo komukoliv
        // s dvaceti znaky. Tady chceme kód, pod kterým fakt leží data.
        const known = await env.ROZPOCET.list({ prefix: 'cur:' + k, limit: 1 });
        if (!known.keys.length) return json({ error: 'neznámý sync kód' }, 401);
        const syms = (url.searchParams.get('s') || '').split(',')
          .map(x => x.trim().toUpperCase()).filter(Boolean).slice(0, 25);
        if (!syms.length) return json({ error: 'chybí symboly' }, 400);
        const out = {};
        await Promise.all(syms.map(async sym => {
          try {
            const r = await fetch(
              'https://query1.finance.yahoo.com/v8/finance/chart/' +
              encodeURIComponent(sym) + '?interval=1d&range=1d',
              { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheTtl: 300 } });
            if (!r.ok) return;
            const m = (((await r.json()).chart || {}).result || [{}])[0] || {};
            const meta = m.meta || {};
            let px = meta.regularMarketPrice;
            let ccy = meta.currency || 'USD';
            /* Londýn kotuje v pencích (GBp/GBX), ne v librách. Bez tohohle
               by se 118 pencí bralo jako 118 liber a hodnota by vyšla
               stokrát vyšší. Totéž ZAc v Johannesburgu a ILA v Tel Avivu. */
            const drobne = { GBp: ['GBP', 100], GBX: ['GBP', 100],
                             ZAc: ['ZAR', 100], ILA: ['ILS', 100] };
            if (drobne[ccy]) { px = px / drobne[ccy][1]; ccy = drobne[ccy][0]; }
            if (typeof px === 'number' && px > 0)
              out[sym] = { px, ccy: ccy.toUpperCase(),
                           nm: meta.longName || meta.shortName || '',
                           ex: meta.fullExchangeName || meta.exchangeName || '' };
          } catch (e) { /* jeden nedostupný papír nesmí shodit ostatní */ }
        }));
        return json({ px: out });
      }

      /* Hledání papíru podle názvu. Přípony burz se pamatují blbě a
         u severských akcií se liší i základ symbolu (XTB píše NOVOB,
         burza NOVO-B), takže hádat je marné — tohle najde papír podle
         toho, jak se jmenuje. */
      if (url.pathname === '/find') {
        const zna = await env.ROZPOCET.list({ prefix: 'cur:' + k, limit: 1 });
        if (!zna.keys.length) return json({ error: 'neznámý sync kód' }, 401);
        const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
        if (!q) return json({ hits: [] });
        try {
          const r = await fetch(
            'https://query1.finance.yahoo.com/v1/finance/search?quotesCount=12&newsCount=0&q=' +
            encodeURIComponent(q),
            { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheTtl: 300 } });
          if (!r.ok) return json({ hits: [] });
          const j = await r.json();
          const hits = (j.quotes || [])
            .filter(x => x.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF'))
            .slice(0, 8)
            .map(x => ({ sym: x.symbol, ex: x.exchDisp || '',
                         nm: x.shortname || x.longname || '' }));
          return json({ hits });
        } catch (e) { return json({ hits: [] }); }
      }

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
