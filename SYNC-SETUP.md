# Synchronizace přes Cloudflare — nastavení jednou a napořád

Appka umí držet data na vlastním malém serveru na Cloudflare. Na rozdíl
od free tieru Supabase se **nepozastavuje za nečinnost** — když ji měsíc
neotevřeš, pořád tam bude.

Je to zdarma, netřeba nic instalovat a zabere to asi 10 minut. Všechno se
klikne na webu Cloudflare.

---

## 1. Účet

Založ si účet na [dash.cloudflare.com](https://dash.cloudflare.com) (stačí
e-mail a heslo, žádná karta).

## 2. Vytvoř úložiště (KV)

V levém menu **Storage & Databases → KV → Create instance**.

- Název: `rozpocet`
- Potvrď.

Tady budou fyzicky ležet data.

## 3. Vytvoř Worker

V levém menu **Workers & Pages → Create → Workers → Create Worker**.

- Název si vyber, třeba `rozpocet-sync`. Z názvu vznikne adresa, takže
  si ji poznamenej — bude vypadat jako
  `https://rozpocet-sync.tvuj-ucet.workers.dev`.
- Dej **Deploy** (nasadí se ukázkový kód, ten hned přepíšeme).
- Pak **Edit code**, smaž všechno, co tam je, a vlož celý obsah souboru
  [`sync-worker.js`](sync-worker.js) z tohohle repa.
- **Deploy**.

## 4. Propoj Worker s úložištěm

Ve Workeru jdi na **Settings → Bindings → Add → KV namespace**.

- **Variable name:** `ROZPOCET` — musí to být přesně takhle, velkými
  písmeny, jinak Worker úložiště nenajde.
- **KV namespace:** vyber `rozpocet` z kroku 2.
- Ulož a dej **Deploy**.

## 5. Ověř, že žije

Otevři v prohlížeči `https://tvoje-adresa.workers.dev/ping`.
Musí odpovědět `{"ok":true}`.

## 6. Zapoj to v appce

V appce jdi do **Nastavení → Synchronizace mezi zařízeními**:

1. Vlož adresu Workeru z kroku 3.
2. Klikni na **Vytvořit připojení**. Appka vygeneruje dlouhý tajný sync
   kód a rovnou nahraje tvoje data.
3. Ukáže se **připojovací kód** — jeden dlouhý řetězec.

## 7. Přidej druhé zařízení

Na mobilu otevři appku → **Nastavení → Synchronizace** → vlož ten
připojovací kód z bodu 6 → **Připojit**. Data se stáhnou.

Připojovací kód si pošli tak, jak ti to vyhovuje (mail sám sobě,
poznámky, WhatsApp). **Kdo ho má, vidí tvůj rozpočet** — ber ho jako
heslo. Když ho budeš chtít zneplatnit, prostě v appce vytvoř nové
připojení; staré přestane platit.

---

## Když se něco pokazí

- **`/ping` neodpovídá** → Worker není nasazený, vrať se ke kroku 3.
- **Appka hlásí „chybí KV binding ROZPOCET"** → krok 4, špatný nebo
  chybějící název proměnné.
- **Appka hlásí „chybí nebo krátký sync kód"** → připojovací kód se
  nepřenesl celý, zkopíruj ho znovu.
- **Přepsala se data nesmyslem** → Worker si drží jednu předchozí verzi.
  Jde stáhnout ručně, například přes konzoli prohlížeče (F12) na
  stránce appky:

  ```js
  fetch('https://tvoje-adresa.workers.dev/prev',{headers:{'X-Sync-Code':'TVUJ_SYNC_KOD'}}).then(r=>r.json()).then(console.log)
  ```

## Co tohle nenahrazuje

Cloud je pro pohodlí (stejná data na PC i mobilu), ne jediná kopie.
Pořád platí:

- připoj si v Nastavení **datový soubor** — ideálně do složky OneDrive,
  tím máš trvalou verzovanou kopii mimo jakoukoliv službu,
- občas si dej **Stáhnout zálohu**.

Priorita je nikdy nepřijít o data, a to znamená víc než jedno místo.
