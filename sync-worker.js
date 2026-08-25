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

   Vedle toho běží (fáze 1, rozpracováno) druhá, oddělená cesta pro účty
   na e-mail + magic link — vše pod `/acct/*`, vlastní D1 databáze
   ACCOUNTS_DB, vlastní KV prefix `acct:`. Sync kód a účty se nikdy
   nepletou dohromady — viz plán v CLAUDE.md.
   ===================================================================== */

const CORS = {
  'Access-Control-Allow-Origin': '*',   // chrání tajný kód v hlavičce, ne origin
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Code,Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

// Sdílený hash pro sync kód i pro oba typy tokenů u účtů — raw hodnota
// se nikdy nikam neukládá, jen tenhle otisk.
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 256bitový náhodný token pro magic link i session — base64url, bez paddingu.
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    if (url.pathname === '/ping') return json({ ok: true });

    /* ---------- účty (e-mail + magic link) ----------
       Úplně jiná autentizace než sync kód níž — token chodí v hlavičce
       Authorization: Bearer, ne X-Sync-Code. Musí se vyhodnotit TADY,
       než appka vůbec sáhne na X-Sync-Code — jinak by každý požadavek
       na účet dostal 401 kvůli chybějící staré hlavičce. */
    if (url.pathname.startsWith('/acct/')) return handleAccount(req, env, url);

    if (!env.ROZPOCET) return json({ error: 'chybí KV binding ROZPOCET' }, 500);

    // Kód chodí v hlavičce, ne v URL — ať se neukládá do logů a historie.
    const code = req.headers.get('X-Sync-Code') || '';
    if (code.length < 20) return json({ error: 'chybí nebo krátký sync kód' }, 401);
    const k = await sha256hex(code);

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

/* =====================================================================
   ÚČTY — e-mail + magic link (fáze 1: jádro identity, zatím bez mailu)
   ---------------------------------------------------------------------
   D1 (ACCOUNTS_DB) drží jen identitu — uživatele, magic linky, session.
   Samotná rozpočtová data zůstávají v KV (ROZPOCET), stejný cur/prev/snap
   vzor jako u sync kódu, jen s prefixem `acct:` a klíčem podle user_id
   místo hashe kódu — nemůže se to s starým systémem nikdy splést.

   FÁZE 1 provizorium: /acct/request-link zatím vrací token přímo
   v odpovědi (`devToken`), protože e-mailová služba (Resend) se zapojí
   až ve fázi 2. Tohle NIKDY nesmí jít do produkce — je to jen pro vývoj
   a testování na jednom stroji.
   ===================================================================== */
async function handleAccount(req, env, url) {
  if (!env.ACCOUNTS_DB) return json({ error: 'chybí D1 binding ACCOUNTS_DB' }, 500);
  const path = url.pathname.slice('/acct/'.length);

  if (path === 'request-link') {
    if (req.method !== 'POST') return json({ error: 'nepodporovaná metoda' }, 405);
    let body; try { body = await req.json(); } catch (e) { return json({ error: 'nevalidní JSON' }, 400); }
    const email = ((body && body.email) || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'neplatný e-mail' }, 400);

    const now = Date.now();
    let user = await env.ACCOUNTS_DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (!user) {
      user = { id: crypto.randomUUID() };
      await env.ACCOUNTS_DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
        .bind(user.id, email, now).run();
    }
    // starý nepoužitý odkaz zneplatnit — ať nezůstávají živé duplicity
    await env.ACCOUNTS_DB.prepare('UPDATE magic_links SET used_at=? WHERE user_id=? AND used_at IS NULL')
      .bind(now, user.id).run();

    const rawToken = randomToken();
    await env.ACCOUNTS_DB.prepare(
      'INSERT INTO magic_links (id, user_id, token_hash, created_at, expires_at, requested_ip) VALUES (?,?,?,?,?,?)'
    ).bind(crypto.randomUUID(), user.id, await sha256hex(rawToken), now, now + 15 * 60 * 1000,
           req.headers.get('CF-Connecting-IP') || '').run();

    // TODO fáze 2: poslat rawToken e-mailem přes Resend a vracet jen {ok:true}.
    return json({ ok: true, devToken: rawToken });
  }

  if (path === 'verify') {
    if (req.method !== 'POST') return json({ error: 'nepodporovaná metoda' }, 405);
    let body; try { body = await req.json(); } catch (e) { return json({ error: 'nevalidní JSON' }, 400); }
    const rawToken = ((body && body.token) || '').trim();
    if (!rawToken) return json({ error: 'chybí token' }, 400);

    const now = Date.now();
    const tokenHash = await sha256hex(rawToken);
    const link = await env.ACCOUNTS_DB.prepare(
      'SELECT * FROM magic_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?'
    ).bind(tokenHash, now).first();
    if (!link) return json({ error: 'odkaz vypršel nebo byl použit' }, 401);
    await env.ACCOUNTS_DB.prepare('UPDATE magic_links SET used_at=? WHERE id=?').bind(now, link.id).run();

    const user = await env.ACCOUNTS_DB.prepare('SELECT * FROM users WHERE id=?').bind(link.user_id).first();
    if (!user) return json({ error: 'účet nenalezen' }, 404);
    await env.ACCOUNTS_DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now, user.id).run();

    const rawSession = randomToken();
    await env.ACCOUNTS_DB.prepare(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent) VALUES (?,?,?,?,?,?,?)'
    ).bind(crypto.randomUUID(), user.id, await sha256hex(rawSession), now, now + 60 * 86400000, now,
           req.headers.get('User-Agent') || '').run();

    return json({ ok: true, token: rawSession, userId: user.id, email: user.email });
  }

  // zbytek cest pod /acct/ vyžaduje platnou (neodvolanou, nevypršelou) relaci
  const session = await requireSession(req, env);
  if (!session) return json({ error: 'neplatná nebo vypršelá relace' }, 401);

  if (path === 'data') {
    if (!env.ROZPOCET) return json({ error: 'chybí KV binding ROZPOCET' }, 500);
    const kvKey = 'acct:cur:' + session.user_id;
    if (req.method === 'GET') {
      const val = await env.ROZPOCET.get(kvKey);
      if (!val) return json({}, 404);
      return new Response(val, { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (req.method === 'PUT') {
      const body = await req.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { return json({ error: 'nevalidní JSON' }, 400); }
      if (!parsed || typeof parsed.data !== 'object' || parsed.data === null)
        return json({ error: 'chybí pole data' }, 400);

      const cur = await env.ROZPOCET.get(kvKey);
      if (cur) await env.ROZPOCET.put('acct:prev:' + session.user_id, cur);
      await env.ROZPOCET.put(kvKey, body);

      const day = new Date().toISOString().slice(0, 10);
      await env.ROZPOCET.put('acct:snap:' + session.user_id + ':' + day, body,
        { expirationTtl: 60 * 60 * 24 * 180 });

      return json({ ok: true, mt: parsed.mt || null });
    }
    return json({ error: 'nepodporovaná metoda' }, 405);
  }

  if (path === 'logout') {
    if (req.method !== 'POST') return json({ error: 'nepodporovaná metoda' }, 405);
    await env.ACCOUNTS_DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?')
      .bind(Date.now(), session.id).run();
    return json({ ok: true });
  }

  return json({ error: 'nenalezeno' }, 404);
}

// Ověří Authorization: Bearer <token> proti D1, prodlouží expiraci relace
// jen když je potřeba (ne při každém požadavku — ušetří zbytečné D1 zápisy
// při odesílání každé změny každých 1,5 s).
async function requireSession(req, env) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('Authorization') || '');
  if (!m) return null;
  const now = Date.now();
  const session = await env.ACCOUNTS_DB.prepare(
    'SELECT * FROM sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?'
  ).bind(await sha256hex(m[1].trim()), now).first();
  if (!session) return null;
  if (!session.last_seen_at || now - session.last_seen_at > 86400000) {
    await env.ACCOUNTS_DB.prepare('UPDATE sessions SET last_seen_at=?, expires_at=? WHERE id=?')
      .bind(now, now + 60 * 86400000, session.id).run();
  }
  return session;
}
