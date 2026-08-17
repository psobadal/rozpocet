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

## Přechod na jiný počítač

Připojovací kód je **jediný klíč k datům v cloudu** a žije jen
v localStorage prohlížeče. Do exportované zálohy se schválně nedává —
kdo by tu zálohu získal, dostal by se i k cloudu. Proto:

**Dokud máš starý počítač, ulož si připojovací kód někam mimo něj** —
správce hesel, poznámky v telefonu, mail sám sobě. Nastavení →
Synchronizace → *Zkopírovat kód*.

Na novém počítači pak stačí:

1. otevřít appku,
2. Nastavení → Synchronizace → vložit připojovací kód → *Připojit*,
3. data se stáhnou.

Datový soubor si připoj znovu — ten je vždycky lokální pro dané zařízení.
Na úpravy appky `git clone` repa, na úpravy Workeru `npx wrangler login`.

Kdybys kód přece jen ztratil, data pryč nejsou — jsi vlastník Cloudflare
účtu, takže se dají vytáhnout přímo z KV úložiště:

```bash
npx wrangler kv key list --namespace-id=<id> --remote
npx wrangler kv key get "cur:<hash>" --namespace-id=<id> --remote
```

Výsledek je JSON, jehož pole `data` jde v appce načíst přes *Obnovit ze
zálohy*. Pak si vytvoř nové připojení — staré tím přestane platit.

Prázdná appka ti cloud nepřepíše: když se připojí zařízení bez dat,
appka pozná, že lokálně nic není, a místo nahrání data stáhne.

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

### Automatická záloha mimo počítač (Disk Google)

Ruční posílání záloh mailem má tu vadu, že kopie je vždycky jen ke dni,
kdy sis ji poslal. Když ji chceš **vždy aktuální a bez práce**, dá se
datový soubor připojit do složky, kterou už něco synchronizuje.

S Gmailem stačí nainstalovat **Disk Google pro počítač** — udělá na PC
složku (typicky disk `G:`) a co do ní přijde, samo nahraje nahoru.
V Nastavení pak dej *Připojit datový soubor* a vyber soubor **uvnitř té
složky**. Řetěz je pak:

```
změna v appce → appka zapíše do souboru → Disk Google to nahraje
```

Výsledek: vždy čerstvá kopie mimo zařízení i mimo Cloudflare, a k tomu
historie verzí souboru přímo v Disku. Soubor má pár set kilobajtů, takže
se do 15 GB zdarma vejde bez řešení.

**Pozor při více počítačích:** kdyby dva počítače připojily ten *samý*
soubor v Disku, budou do něj zapisovat dvě appky nezávisle a Disk začne
dělat konfliktní kopie. Buď to udělej jen na jednom počítači, nebo dej
každému vlastní název (`rozpocet-pc1.json`, `rozpocet-pc2.json`).
Synchronizaci mezi zařízeními řeší Worker — tenhle soubor je jen záloha,
nemá sloužit k přenosu dat.

Nemusí to být zrovna Disk Google, funguje jakákoliv synchronizovaná
složka (Dropbox, OneDrive…). Jde jen o to, aby soubor někdo průběžně
odnášel z počítače pryč.
