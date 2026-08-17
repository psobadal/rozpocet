# Synchronizace přes Cloudflare — nastavení jednou a napořád

Appka umí držet data na vlastním malém serveru na Cloudflare. Na rozdíl
od free tieru Supabase se **nepozastavuje za nečinnost** — když ji měsíc
neotevřeš, pořád tam bude.

Je to zdarma, netřeba nic instalovat a zabere to asi 10 minut. Všechno se
klikne na webu Cloudflare.

---

> **Zkratka pro toho, kdo umí příkazovou řádku:** v repu je `wrangler.jsonc`,
> takže stačí `npx wrangler login` a `npx wrangler deploy` ze složky projektu.
> KV úložiště se musí založit jednou předem:
> `npx wrangler kv namespace create rozpocet` a jeho `id` vepsat do
> `wrangler.jsonc`. Zbytek návodu je ruční cesta přes web.

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
- **Přepsala se data nesmyslem** → v appce **Nastavení → Synchronizace →
  Starší verze**. Úložiště si každý den odloží jednu verzi a drží je půl
  roku, takže se dá vrátit i o měsíce zpátky. Samotné obnovení jde taky
  vzít zpět — předchozí stav zůstane v `prev`.

## Verze a zálohy

O historii se stará úložiště samo:

| kde | co to je | jak dlouho |
|---|---|---|
| `cur` | aktuální data | pořád |
| `prev` | stav těsně před posledním zápisem | do dalšího zápisu |
| `snap:<datum>` | jedna verze za každý den | půl roku |

Ručně stáhnout předchozí verzi jde i přes konzoli prohlížeče (F12) na
stránce appky:

```js
fetch('https://tvoje-adresa.workers.dev/prev',{headers:{'X-Sync-Code':'TVUJ_SYNC_KOD'}}).then(r=>r.json()).then(console.log)
```

## Co tohle nenahrazuje

Cloud je pro pohodlí (stejná data na PC i mobilu) a teď i pro historii.
Pořád ale platí, že jedna služba je jedno místo:

- připoj si v Nastavení **datový soubor** do běžné složky na disku
  (třeba `Dokumenty\Rozpočet`). Chrání to hlavně proti smazání dat
  prohlížeče — to je zdaleka nejčastější způsob, jak o ně přijít,
- občas si dej **Stáhnout zálohu** a soubor si někam odlož (mail sám
  sobě úplně stačí). Tohle je jediná kopie, která přežije i to, že by
  ti shořel počítač a zároveň zmizel Cloudflare účet.

Priorita je nikdy nepřijít o data, a to znamená víc než jedno místo.
