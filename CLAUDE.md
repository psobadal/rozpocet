# Můj rozpočet — kontext pro pokračování

Osobní rozpočtová appka od výplaty k výplatě pro Patrika. Jeden soubor
`index.html`, žádný build, žádné závislosti — otevře se dvojklikem nebo
na webu. Cílem je i „free appka pro kohokoliv" (viz README.md).

## Kde to žije

- **Lokálně (Mac, aktuální):** `~/Documents/GitHub/rozpocet/` — plný `git clone`.
  Pozor: na Ploše bývá i `~/Desktop/Claude/rozpocet-main/`, což je jen rozbalený
  ZIP bez `.git` a **zastaralý** — needituj ho, změny se odtamtud nikam nedostanou.
- **GitHub:** [psobadal/rozpocet](https://github.com/psobadal/rozpocet) (veřejné repo, účet uživatele)
- **Živě na webu:** https://psobadal.github.io/rozpocet/ (GitHub Pages, větev `main`, root)
- **Synchronizace:** vlastní Worker na Cloudflare (`sync-worker.js` v repu, návod
  v `SYNC-SETUP.md`). Data v KV, přístup přes dlouhý tajný „sync kód" v hlavičce
  `X-Sync-Code` (klíč v KV je jeho SHA-256 otisk). Worker drží tři vrstvy:
  `cur:` (aktuální), `prev:` (stav před posledním zápisem) a `snap:<hash>:<datum>`
  (jedna verze za den, `expirationTtl` půl roku). V appce se z nich obnovuje přes
  „Starší verze" (`wkVersions`/`wkRestore`) — obnovení samo dělá `pushBackup()`
  a přepíše `prev:`, takže i chybné obnovení jde vzít zpět.
  Adresa+kód žijí v localStorage pod
  `rozpocet-v2-sync`, **záměrně mimo `S`** — ať se tajný kód nedostane do exportu
  zálohy ani do dat nahraných do cloudu.
  **Proč ne Supabase:** free tier se po ~týdnu nečinnosti pozastaví a zmizí i
  z DNS — reálně se to stalo, přihlášení přestalo fungovat. Cloudflare Workers
  za nečinnost neusínají. Zbytky Supabase kódu (auth tokeny, magic link,
  `cloudPull`/`cloudPush`, `CONFIG.cloud`, mezivrstva `remote*`) jsou od
  18. 8. 2026 **úplně pryč** — appka žádné přihlašování e-mailem nemá a
  nikdy mít nebude, přístup k datům je jen přes připojovací kód.

## Worker na Cloudflare (wrangler)

Nasazeno a živé od 17. 8. 2026:

- **Adresa Workeru, účet a ID úložišť** nejsou v repu (je veřejné) — žijí
  v `LOCAL-NOTES.md`, který je v `.gitignore`. ID KV a D1 jsou i ve
  `wrangler.jsonc`, protože bez nich nejde nasadit; nejsou to přihlašovací
  údaje, samy o sobě nikomu přístup nedají.
- Připojená jsou dvě PC a mobil (všechna sdílejí jeden sync kód → v KV je
  jeden trojklíč `cur:`/`prev:`/`snap:` pod stejným hashem).

**Worker pouští jen povolené kódy.** Kontrola délky (≥ 20 znaků) sama o sobě
pustí kohokoliv, kdo zná adresu Workeru — a ta je v historii gitu, protože
repo je veřejné. Kdokoliv by si sem tedy mohl ukládat vlastní data: sežral by
free tier a majitel účtu by nevědomky hostoval cizí finanční data (GDPR).
Proto se otisk kódu porovnává se seznamem v tajemství `ALLOWED_HASHES`
(`npx wrangler secret put ALLOWED_HASHES`, hodnota = hashe oddělené čárkou,
nikdy v repu). **Když tajemství chybí, Worker se chová jako dřív a pustí
všechno** — špatně nasazené tajemství nesmí odstřihnout majitele od dat.
Pozor: po vygenerování nového připojovacího kódu se musí seznam přenastavit,
jinak appka přestane synchronizovat. Otisk stávajícího kódu jde přečíst
z názvů klíčů `cur:<hash>` v KV.

Nasazení změny Workeru (konfigurace je ve `wrangler.jsonc`, KV binding `ROZPOCET`):
```bash
npx wrangler deploy
```

**Přihlášení je per-počítač** a na novém stroji chybí — `npx wrangler login`
otevře OAuth v prohlížeči, kde musí uživatel kliknout Allow. Token se ukládá do
`%APPDATA%\xdg.config\.wrangler\config\default.toml`. Pozor na dvě věci:
`wrangler login` běží krátce a **vyprší, když uživatel neklikne hned** — spouštět
na pozadí, z výstupu vytáhnout OAuth URL a rovnou mu ji otevřít. Autorizaci
uživatel vědomě nechal aktivní (ruší se v Cloudflare pod My Profile → Access
Management → **Connected Applications**, ne pod starou adresou `authorized-apps`).

Nahlédnutí do dat nebo záchrana, když se ztratí sync kód:
```bash
npx wrangler kv key list --namespace-id=<id z wrangler.jsonc> --remote
npx wrangler kv key get "cur:<hash>" --namespace-id=<id z wrangler.jsonc> --remote
```
`kv key delete` **nemá** přepínač `--force` (s ním jen vypíše nápovědu a tváří se,
že smazal) a `kv key list` je eventuálně konzistentní, takže hned po mazání může
ukázat starý stav. Do KV nesahat bez důvodu — jsou tam reálná data uživatele.

## Účty na e-mail (rozpracováno, fáze 1 hotová)

Vedle sync kódu (výše) appka staví **druhý, oddělený** systém přihlášení —
e-mail + magic link, na účet uživatele s vlastní databází. Cíl: appku jde
otevřít cizím lidem, ne jen tomu, kdo si sám rozjede Cloudflare Worker.
Podrobný plán (schéma, endpointy, fáze, proč) je v
`~/.claude/plans/majestic-humming-hartmanis.md`. **Zásadní pravidlo, které
platí po celou dobu stavby:** starý sync-kód systém se nesmí ani dotknout —
žádná migrace, žádné sdílené klíče, jen paralelní cesta vedle něj.

**Databáze:** D1 `rozpocet-accounts`, binding `ACCOUNTS_DB` ve `wrangler.jsonc`. Schéma v `d1-schema.sql`
(`users`/`magic_links`/`sessions`), nasazení:
```bash
npx wrangler d1 execute rozpocet-accounts --remote --file=./d1-schema.sql
```
Rozpočtová data účtu **nejsou** v D1 — zůstávají v tom samém KV `ROZPOCET`
jako sync kód, jen s prefixem `acct:cur:<user_id>` / `acct:prev:<user_id>` /
`acct:snap:<user_id>:<datum>` místo `cur:<hash>` atd. — formátově
nezaměnitelné se starými klíči (UUID vs. sha256 hash), navíc explicitní
prefix pro jistotu při čtení `wrangler kv key list`.

**Hotovo (fáze 1 — jádro identity, `sync-worker.js`):** `/acct/request-link`,
`/acct/verify`, `GET`/`PUT /acct/data`, `/acct/logout`. Ověřeno end-to-end
přes `wrangler dev --remote` i po nasazení do produkce, včetně: neplatný
e-mail, neplatný/expirovaný/dvakrát použitý token, izolace mezi uživateli,
že rotace `cur→prev` a denní snapshot fungují stejně jako u sync kódu,
a hlavně — že starý sync-kódový systém běží beze změny (kontrola přes
`wrangler kv key list`, žádný `acct:` klíč mezi starými, žádný starý klíč
změněný). Testovací uživatelé/klíče po každém testu ručně smazané, ať
databáze nezůstává zaneřáděná cizími testovacími řádky.

**Zatím chybí (viz plán):** `/acct/prev`, `/acct/list`, `/acct/snap/<date>`
(mirror starých endpointů), `/acct/logout-all`, `/acct/delete-account`,
rate limiting na `/acct/request-link`, **reálné odesílání e-mailu** —
`/acct/request-link` dnes vrací token přímo v odpovědi (`devToken`), což je
**vyloženě dočasné a nesmí to jít do provozu, kde by to viděl někdo cizí** —
nahradí se až se zapojí Resend. Celé `index.html` je zatím nedotčené —
appka, kterou Patrik denně používá, o účtech vůbec neví, dokud nepřijde
fáze klientské integrace.

## Jak nasazovat změny

Po každé sadě úprav v `index.html`:
```bash
git -C ~/Documents/GitHub/rozpocet add index.html
git -C ~/Documents/GitHub/rozpocet commit -F <soubor_se_zpravou>
git -C ~/Documents/GitHub/rozpocet push
```
Používej `git -C <cesta>` — pracovní adresář Bash toolu se mezi voláními vrací
jinam a `git` pak hlásí „not a git repository". Commit zprávu piš do dočasného
souboru a commituj přes `-F` (multi-line `-m` dělá potíže s diakritikou).
Jméno a mail pro commity jsou nastavené lokálně v gitu, nepatří sem.
Na Windows se navíc push pouštěl na pozadí s `GIT_TERMINAL_PROMPT=1`, na Macu
to není potřeba. GitHub Pages se aktualizuje samo do ~30 s po pushi.

**Vždy nejdřív otestuj v prohlížeči.** `file://` snapshot v Browser panelu
nedává živý JS kontext — spusť `python3 -m http.server 8765` ve složce repa
a otevři přes `preview_start` na `http://localhost:8765/index.html`
(`navigate` na `127.0.0.1` je blokované politikou, `localhost` projde).
Appku lze celou ovládat/testovat přímo přes JS konzoli (`S`, `go()`,
`commit()`, všechny funkce jsou globální; render jde do `#app`). Synchronizaci
testuj podvržením `window.fetch` jako falešný Worker — projde tím push, pull,
připojení druhého zařízení i pojistky. Teprve po
zeleném testu commitovat a pushnout.

## Datový model (proměnná `S`)

```
S.periods[]      — výplatní cykly: {id, nm, from, to, income[], cats[]}
  cats[].it[]    — položky: {id, nm, pl (plán), log[] (datum+částka+poznámka),
                   kind? ('need'|'want'|'save', přebíjí kategorii), link? ('debt:id'|...)}
S.envelopes[]    — obálky/cíle: {id, nm, icon, bal, monthly, target, due, hist[]}
S.investments[]  — investice/spořáky: {id, nm, icon, val, base (vloženo), rate, lastInt, hist[]}
S.debts[]        — dluhy: {id, nm, icon, type, group, principal, rate, paid0, monthly,
                   fixDate, rateAfter, paidToPrice, pay[]}
S.debtGroups{}   — projekty typu "Byt": {jméno: {price, ltv, contrib[], fees[]}}
S.ui             — appName, accent, numFont, tabs[] (pořadí/viditelnost/název)
S.tax            — daň z úroků (výchozí 15 %)
```

## Klíčové koncepty (proč to tak je)

- **Cyklus = výplata, ne kalendářní měsíc.** `S.periods` má vlastní `from`/`to`,
  uživatel je zadává ručně (výplata mu chodí 14.–18., nikdy stejně).
  **Kalendářní měsíc jde nastavit taky** — od prvního do prvního — a další
  období se pak předvyplňují sama správně. Nic se kvůli tomu neprogramovalo,
  jen se to říká na úvodní stránce, ať to lidi napadne.
  `addMonth()` přičítá měsíc **bez přetečení**: 31. 1. + měsíc je 28. 2.
  (v přestupném roce 29. 2.), ne 3. 3. Naivní `new Date(rok, měsíc+1, den)`
  den nedrží a únor 31 si přepočítá na březen — kdo začal na konci měsíce,
  dostal předvyplněné nesmyslné období (nalezeno a opraveno 1. 9. 2026).
  Používá to `curCycleDates()` i `newPeriodModal()`. Místa, kde se přičítá
  měsíc a den se předtím nastaví na 1 nebo 0 (`nwSeries`, `creditInterest`),
  jsou v pořádku a nechají se být.

- **Sinking fund model u obálek — nikdy neměnit bez rozmyslu:** vklad do obálky
  = výdaj TEĎ (sníží „zbývá volných", počítá se do „odloženo tento cyklus").
  Čerpání z obálky se do „zbývá" už NEpočítá znovu (peníze byly „utraceny"
  při vkladu) — čerpání má jen nepovinnou kategorii pro statistiky.
  **Oprava zůstatku** (přes tužku/edit obálky, pole „Zůstatek") je třetí case:
  mění bal, ale rozdíl má `hist` entry s `adj:true`, který se NEpočítá do
  `savedInPeriod` ani se nezobrazuje v „Tento cyklus" — používá se pro zápis
  starších úspor, co nebyly odloženy TEĎ z výplaty. Bez tohohle flagu appka
  omylem srážela „zbývá volných" za historické částky (opravena chyba).
  **Čerpání s kategorií je jen zobrazovací, ne rozpočtové:** `catActual(c)`/
  `sumActual(p)` (počítá se do „zbývá volných") zůstávají čisté položky
  z Výdajů — NIKDY nezahrnují peníze čerpané z obálek. Pro zobrazení (dlaždice
  na Výdajích, detail kategorie, „Kam jdou peníze" na Přehledu, Statistiky)
  se používá `catActualDisplay(c,pid)` = `catActual(c) + envSpendForCat(c.nm,pid)`
  — sečte i peníze zaplacené z obálky s tou kategorií. Tohle rozdělení
  (rozpočtové číslo vs. zobrazovací číslo) je záměrné a důležité, neslučovat.

- **Dlouhodobý pohled (roky) na obálky vs. kategorie — už vyřešeno, neřešit znovu.**
  Uživatel se ptal: když 5 měsíců odkládám do obálky a pak vyberu na
  Cestování, nemělo by se to "odepsat" z nějaké souhrnné položky "Obálky"
  v celoroční statistice, aby se to nepočítalo dvakrát? Odpověď: appka to
  řeší už teď, automaticky, přes `nwBlock()` (zobrazuje se pod každým
  statistickým pohledem = Přehled i Statistiky). Tam je "Obálky" =
  `totalEnvelopes()`, tedy **aktuální živý zůstatek**, ne historický součet
  vkladů. Když vyberu 2500 na Cestování, zůstatek klesne na 0 → "Obálky" v
  Čistém jmění klesne na 0 samo, zatímco "Cestování" v `catActualDisplay`
  vzroste o 2500. Žádné ruční odečítání není potřeba — je to bookkeeping
  identita (vklady − výběry = zůstatek), takže součet (kategorie +
  Obálky) přes celou historii vždy sedí bez dvojího počítání. Pokud by
  appka měla obálky ukazovat i přímo v grafu "Podíl kategorií" (ne jen v
  Čistém jmění), řešilo by se to samostatně za cyklus — zatím nebylo
  požadováno.

- **Pojistka proti přepsání dat prázdným stavem — nikdy neodstraňovat.**
  `stateEmpty(s)` pozná prakticky prázdný stav (výchozí appka, nebo stav po
  nepovedeném načtení localStorage). Takový se do cloudu nikdy nenahraje:
  hlídá to `doPush()` i obě větve v `syncNow()`. Bez toho hrozily dva reálné
  scénáře ztráty dat — (1) `remotePull()` nevrátil řádek kvůli výpadku a tichá
  synchronizace nahrála lokální prázdno přes plný cloud, (2) prázdný lokál
  s novějším `mt` přebil starší, ale plný cloud. Pozor: výchozí stav má dva
  řádky příjmu s nulami, takže se testují **hodnoty**, ne délky polí.
  Úmyslné vynulování jde pořád přes „Začít načisto" (`finishFirstLogin(false)`).
  Výpadek cloudu musí být hlasitý — červený banner na Přehledu, ne jen tichý
  `syncState='err'` v pilulce (tichá verze způsobila, že si uživatel týden
  myslel, že je zálohovaný, a nebyl).

- **Investice: vklad vs. zhodnocení.** `inv.base` = kolik jsi tam dal ze svého.
  Tlačítko „+ Kč" = vklad (base i val rostou). Tlačítko „Přecenit" = trh se
  pohnul (jen val roste, rozdíl je `hist` entry s `k:'gain'`, nepočítá se do
  „investováno tento cyklus"). Úrok u spořáku se připisuje automaticky
  k 1. dni v měsíci (`creditInterest()`), taky jako `k:'gain'`.

- **Investice typu krypto — auto kurz z CoinGecko.** Investice může mít
  `inv.crypto` (CoinGecko id, např. `'bitcoin'`) + `inv.qty` (množství)
  místo ruční hodnoty. `fetchCryptoPrice(id)` stáhne kurz rovnou v Kč
  (`vs_currencies=czk`, žádný zvlášť dopočet USD→CZK). `val` se dopočítá
  jako `qty*kurz`. Tlačítko „Aktualizovat kurz" (`invRefreshPrice`)
  přecení podle živého kurzu úplně stejnou logikou jako ruční „Přecenit"
  (rozdíl = `hist` entry s `k:'gain'`) — jen bez dialogu, kurz se stáhne
  sám. Editace množství v `invModal`/`saveInv` jde přes stejnou
  base-adjustment logiku jako ruční oprava hodnoty (žádný speciální case).
  Tlačítko „+ Kč" (vklad v Kč) u krypto položky nedává smysl a je schované
  — množství se mění jen přes editaci (tužka). Je to jediné místo v appce
  závislé na internetu (fetch), vše ostatní je čistě offline — bez
  připojení `invCryptoPreview`/`invRefreshPrice` jen ohlásí chybu a
  neprovedou žádnou změnu dat.

- **Akcie a ETF — auto kurz přes vlastní Worker.** `inv.stock` (symbol),
  `inv.qty` (kusy), `inv.ccy` (měna burzy, doplní se ze zdroje).
  Symbol má evropská burza za tečkou: `IMAE.AS`, `VWCE.DE`, `CSPX.L`;
  americké akcie jsou prosté (`AAPL`).
  **Proč přes Worker a ne přímo:** burzovní zdroj neposílá CORS hlavičky,
  takže z prohlížeče zavolat nejde. Endpoint `/px` v `sync-worker.js` si
  kurz vyzvedne serverově a podá ho appce (`fetchStockQuotes` → `wkFetch`).
  **Odpadlo Twelve Data** (19. 8. 2026) — free tier neuměl evropské ETF,
  na `IMAE.AS` hlásil „available starting with the Grow plan". Tím zmizel
  i `S.stockKey`; `migrate()` ho maže. Nový zdroj nechce klíč ani
  registraci a pokrývá všechny burzy.
  **Daň za to:** kurzy akcií jedou jen se **zapnutou synchronizací**
  (Worker je nosič). Bez ní to řekne a nechá zadat hodnotu ručně;
  krypto přes CoinGecko jede pořád i bez syncu.
  `/px` ověřuje sync kód proti KV (`list` s prefixem `cur:`), ne jen jeho
  délku — jinak by Worker sloužil komukoliv s dvaceti znaky jako proxy.
  Ceny chodí v měně burzy, přepočet dělá `fetchFx()` přes
  frankfurter.dev (ECB, bez klíče, hodinová cache). CZK papíry se
  nepřepočítávají vůbec. `fmCcy(n,ccy)` je formát bez „Kč" — `fmEx` by
  k cizí měně lepilo koruny a vznikalo „300 Kč USD" (nahlášeno a
  opraveno). **Kurz se stahuje jen při změně symbolu**, ne při přepsání
  počtu kusů.

- **Mazání uklízí propojené zápisy.** `delItem` to dělal odjakživa,
  `delCat` a `delPeriod` na to zapomínaly — smazané období nechávalo
  splátky viset v dluhu, ten pak napořád tvrdil, že je splacený o víc,
  a záznam nešlo dohledat ani smazat (nalezeno a opraveno 20. 8. 2026).
  Společné pomocníky jsou `logIdsOf`/`countLinked`/`linkedTxt`; dialog
  navíc předem řekne, kolik propojených záznamů zmizí. Přímé vklady do
  obálky (přes Rychlé zadání) se schválně NEmažou — nejsou odrazem
  položky, ty peníze v obálce fakt jsou.

- **Symbol z brokera se přeloží sám** (`mapSymbol`/`BURZA_MAP`). Brokeři
  značí burzu podle **země** (XTB: `IMAE.NL`), burzovní data podle
  **burzy** (`IMAE.AS`). Uživatel opsal symbol z XTB, appka řekla
  „nenalezen" a vypadalo to jako chyba appky — přitom oba měli pravdu,
  jen každý mluvil jinou řečí. Při neúspěchu se proto nejdřív zkusí
  překlad (NL→AS, UK→L, FR→PA, CZ→PR, US→bez přípony…) a když projde,
  symbol se přepíše sám a **napíše se proč**. Teprve pak přijde na řadu
  `suggestSymbols` (tentýž základ na obvyklých burzách) a **hledání
  podle názvu** přes `/find` — obojí paralelně, ať to netrvá dvakrát.
  `/find` je Yahoo search přes Worker; hledá se podle pole **Název**,
  takže „Novo Nordisk" najde papír i když je symbol úplně mimo.
  **Severské burzy píšou třídu akcie s pomlčkou** (`NOVO-B.CO`,
  `VOLV-B.ST`), brokeři ji vynechávají (`NOVOB.DK`) — `mapSymbol` proto
  vrací víc kandidátů a pomlčkovou variantu zkouší taky. Pozor:
  `NOVOB.CO` Yahoo vrátí jako platnou odpověď, ale bez ceny a s burzou
  „YHD" — proto ta kontrola `typeof px === 'number' && px > 0`
  ve Workeru, bez ní by se uložil papír s nulou.
  Všechno běží jen při neúspěchu, takže to nic nestojí navíc.

- **Přehled kurzů k porovnání s brokerem** (`pxOverviewModal`), tlačítko
  „Kurzy" na Investicích. Ukazuje **celý řetěz výpočtu** — kusy × kurz ×
  měna = hodnota — protože když číslo nesedí s brokerem, je potřeba
  vidět, ve kterém kroku se to rozešlo, ne jen výsledek.
  **Není to tabulka, a to schválně:** první verze měla šest sloupců
  a na mobilu z ní byla vidět jen levá půlka — Hodnota, tedy jediné
  číslo, kvůli kterému to člověk otevírá, zůstala za okrajem (nahlásil
  uživatel). Teď je to seznam řádků, kde je výpočet v podtitulku a
  zalomí se jako text. Podtitul má `white-space:normal`, protože `.t2`
  má v appce zákaz zalomení a ořezávalo to výpočet třemi tečkami.
  Akcie a krypto mají **oddělené součty** — krypto v brokerovi není,
  takže společný součet by proti němu nikdy neseděl. Kvůli tomu se
  při každém stažení ukládá `inv.px` (kurz v měně burzy) a `inv.fx`
  (přepočet na Kč); bez nich by šlo dopočítat jen Kč/ks. Drobný rozdíl
  proti brokerovi je normální (ECB kurz vs. kurz brokera s marží, jiný
  okamžik stažení) a je to v modalu napsané — dvojnásobek ale znamená
  špatný symbol, typicky jiná třída akcie.

- **Londýn kotuje v pencích, ne librách.** Yahoo vrací `GBp` (a `ZAc`,
  `ILA`), což by po `toUpperCase()` splynulo s `GBP` a hodnota by vyšla
  **stokrát vyšší**. Worker to proto dělí stem a měnu normalizuje ještě
  před odesláním do appky (nalezeno 20. 8. 2026 při ověřování převodní
  tabulky, než na to stihl narazit uživatel).

- **Dluhy — skupiny/projekty (Byt, Auto...).** `S.debtGroups[jméno]` může
  existovat BEZ jediného dluhu (založíš projekt dřív, dluhy přidáváš postupně).
  `price` = čistá kupní cena. `fees[]` a `contrib[]` (vlastní vklady) jsou
  logy, ne jedno číslo — přidávají se jednotlivě, appka sčítá. **LTV se počítá
  jen z `price`, NIKDY ne z price+fees** (banky to tak nedělají — byla to
  nahlášená a opravená chyba). Dluh má `paidToPrice` (bool) — dokud není
  zaškrtnuté, jeho jistina se do „chybí dofinancovat" nepočítá (řeší situaci
  „mám sjednanou půjčku, ale peníze ještě nešly do koupě").
  `fixDate`+`rateAfter` = jednorázová plánovaná změna úroku (refix), počítá se
  v `amortizeFix()`. `debtLifetimeCost(d)` počítá CELKOVÉ náklady od začátku
  (z `principal`, ne z aktuálního zbytku) — to je číslo „kolik na tom fakt
  zaplatíš", ukazuje se na kartě dluhu i v souhrnu skupiny.
  U hypotéky (ikona domečku nebo „hypo" v názvu/štítku) appka sama nabídne
  splátku při typických 30 letech, pokud splátku ani dobu nezadáš — matematicky
  nejde odvodit jen z jistiny+úroku (chybí 3. číslo), ale je to rozumný default.

- **50/30/20:** typ (`need`/`want`/`save`) je primárně na kategorii, položka
  ho může přebít (`it.kind`). Propojené položky (`link`) jsou automaticky `save`.

- **Kategorie jde přeřadit** — šipky ◀▶ přímo na dlaždici na Výdajích
  (`moveCat(id,dir)`), i v detailu kategorie. Klik na šipku má
  `event.stopPropagation()`, ať se neotevře detail.

- **Žádné bulk/automatické stržení peněz mimo Výdaje a Rychlé zadání.**
  Uživatel to výslovně nechce — byly odstraněny „Odložit měsíční" (u obálek)
  a „Zaplatit pravidelné" i celý koncept `it.fixed` (u výdajů). Necouvat na
  tohle bez výslovného požadavku.
  **Pozor na záměnu:** `it.fixAmt` (zaškrtávátko „pevná", přidáno 18. 8. 2026
  na výslovné přání) **není** návrat `it.fixed`. Nic se nestrhává samo ani
  hromadně — je to jen předvyplnění částky v Rychlém zadání, když si vyberu
  položku, u které se platí pořád stejně (internet 329,35). Pořád musím
  kliknout, pořád jen jedna položka. Bulk tlačítko „zaplatit všechny
  pravidelné" tam nepřidávat.
  **Je to bool, ne číslo, a to schválně:** částka se bere z `it.pl` (plán).
  První verze měla vlastní `it.amt`, jenže u pevné platby je plán ta samá
  částka, takže uživatel viděl v detailu dvakrát vedle sebe 329,35 — sám to
  nahlásil. `migrate()` staré číselné `it.amt` překlopí na `pl` + `fixAmt`.
  Zaškrtnuté bez plánu = varování, ne tiché nic.

- **Rychlé zadání nic nepředvybírá.** Kategorie i položka začínají na
  „— vyber… —" a bez obojího to nezapíše. Dřív svítila první kategorie
  a první položka, takže se dala částka omylem připsat úplně jinam.
  Položka se vybírá ze seznamu (zápis přes `id`), ne psaním názvu — volný
  text se porovnával na název a kdo se netrefil, založil duplikát vedle
  původní položky. U obálky zůstává volný text, obálka položky nemá.

- **Účet v panelu Zápis se předvolí v tomhle pořadí:** co jsi v panelu
  zvolil ručně (`zapisAcc`), jinak účet, ze kterého se u vybrané položky
  platí vždycky (`it.defAcc`), jinak aktivní účet nahoře, jinak výchozí.
  Dřív panel `it.defAcc` ignoroval (fungovalo to jen v řádku uvnitř
  detailu kategorie) a každé překreslení panelu ruční volbu účtu mazalo.
  Dlaždice cílů v panelu jdou po vyrovnaných řadách (`zsGrid`: 10 = 4+3+3,
  ne 4+4+2), řady po nejvýš čtyřech.

- **Donuty ukazují hodnotu po najetí** (`donutSeg`, `donutAttr`,
  `donutRow`, data v `donuts[id]`). Koláč na Výdajích i podíl kategorií ve
  Statistikách: najetí myší nebo focus na výseč ukáže uprostřed název,
  částku a podíl a ostatní výseče ztlumí; stejně reagují řádky seznamu
  kategorií a legenda. Na dotykovém displeji se najetí ignoruje (mobilní
  prohlížeč ho simuluje při klepnutí) a výseč se přepíná klepnutím, jinak
  by se hned zase zavřela. Název uprostřed je v barvě textu s barevnou
  tečkou, ne v barvě kategorie (oranžová by neprošla kontrastem).
- **Položky v detailu kategorie jsou varianta D** (vybral Patrik
  29. 9. 2026 z pěti návrhů): každý řádek (`.itr`) se podbarví (`.itfill`)
  tak daleko, kolik z plánu je utraceno, zeleně / zlatě nad 85 % /
  červeně přes plán. Pevná platba zaplacená celá je zelená, ne zlatá (je
  hotová, ne „blízko plánu"). Vpravo částka a pod ní „z plánu", pod názvem
  jen to, co za řeč stojí: o kolik je přes plán, štítek 50/30/20 a kam se
  propisuje. Plán je pod částkou schválně: vedle sebe na jednom řádku
  stlačil dlouhé názvy na „Splát…". Přidání položky je tlačítko,
  pole se otevřou až po kliknutí (`novaPolozka`) a po přidání zůstanou
  otevřená pro další.
- **Plán kategorie je sbalený řádek** pod položkami (`catPlanOpen`).
  Normálně se sčítá z položek; jeden plán za celou kategorii (`c.pl`) je
  výjimka, vysvětlená až po rozkliknutí, a když platí, řádek to říká
  hned. Dřív to byla karta s polem „0" a textem, kterému nikdo nerozuměl.

- **Psaní na mobilu nesmí skákat** (nahlásil Patrik 29. 9. 2026: datum
  v Zápisu přiblížilo stránku a musel oddalovat). Tři pravidla:
  (1) na dotyku (`pointer:coarse`) mají všechna pole písmo aspoň 16 px,
  jinak je iPhone při klepnutí přiblíží; přibližování prsty zůstává
  zapnuté, vypnuté je jen dvojí klepnutí (`touch-action:manipulation`).
  (2) Překryv dialogu se drží ve viditelné části obrazovky (`drzOverlay`
  přes `visualViewport`), takže Zápis nezajede za klávesnici; Android to
  dělá sám díky `interactive-widget=resizes-content` ve viewportu.
  (3) Během psaní se nepřekresluje celá stránka: hledání v Pohybech mění
  jen `#pohres` (`pohObnov`), pole zůstává a klávesnice se nezavře.
  Ověřeno jen v emulaci mobilu; simulátor iPhonu bez plného Xcode nejde.

- **Zápis na dotyku jde po krocích a má vlastní číselník**
  (`zapisHTMLDotyk`, rozhoduje `zapisDotyk()` = `pointer:coarse`).
  I po opravě přibližování to Patrikovi na telefonu vadilo: částka
  vytáhla systémovou klávesnici, ta zakryla dlaždice i Zapsat a mezi
  poli vyjížděla a zajížděla. Vybral si spojení tří návrhů (29. 9. 2026):
  kroky **Za co → položka → Kolik** (u obálky, investice, dluhu a
  přesunu jen dva), nahoře v kroku 1 **Naposledy** (`zapisNedavne`,
  max 4 položky podle času pořízení zápisu z `uid()`, ne podle data
  výdaje), částka na **číselníku v panelu** (`zapisKlav`, v `zapisAmt`
  s tečkou), systémová klávesnice jen u poznámky a názvu nové položky,
  a při psaní poznámky se číselník jen zneviditelní (`zapisPise`,
  třída `.pise`, `visibility:hidden`, velikost panelu se nemění) a
  klávesnice ho překryje. Datum a účet jsou malé štítky (`.zc`) s
  neviditelným nativním polem 16 px pod sebou: viditelná pole s 16 px
  byla obří a menší písmo by iPhone při klepnutí přiblížil.
  Pevná platba se předvyplní a první stisk ji přepíše.
  **Poznámka je nad částkou, ne pod ní**: pod částkou ležela kousek pod
  horní hranou klávesnice (s lištou automatického vyplňování) a Safari
  pak sám posunul celou stránku s rezervou navíc, uřízl záhlaví a nad
  klávesnicí nechal prázdno. Pole, do kterého se píše, musí být v panelu
  tak vysoko, aby na něj klávesnice nedosáhla (teď 420 px nad spodkem).
  Motor zůstává `quickAdd()`, krok 3 mu podá stejná pole jako skrytá.
  **Na počítači je Zápis beze změny** (jeden panel, Enter zapíše).
  Pozor na zmenšování panelu pod prstem: první verze schovávala číselník
  hned při klepnutí do poznámky, panel se zmenšil, klepnutí doběhlo na
  pozadí a Zápis se zavřel (nahlásil Patrik týž den). Proto se panel
  při psaní nezmenšuje a `openModal` zavírá jen tehdy, když dotyk na
  pozadí i začal (`pointerdown`), ne jen skončil.
  **Spodní panel a klávesnice** (`drzOverlay`, jen `.ov-sheet`): překryv
  zůstává přes celou obrazovku a panel se zvedne (`padding-bottom`
  s přechodem) jen o tolik, aby pole s kurzorem bylo nad klávesnicí;
  když je vidět i tak, nehne se vůbec. Dřív se překryv zkracoval na
  viditelnou část: panel vyskočil o celou klávesnici a při tažení
  prstem pod ním prosvítala stránka. Poloha pole bez zvednutí se počítá
  ze vzdálenosti od spodku panelu, ne z aktuální polohy (ta se během
  animace posouvá). Ostatní dialogy mají pořád starou logiku.
  Při testu v Browser panelu na pozadí stojí CSS animace na začátku;
  pro měření je vypni (`*{transition:none;animation:none}`).

- **Donut na dotyku se klepe podle úhlu** (`donutKlep`, `donuts[id].cum`).
  Výseč byla tenký prstenec a malé kategorie nešly trefit; navíc focus
  z klepnutí výseč zapnul a klepnutí ji hned vypnulo. Na dotyku teď
  focus nic nedělá, klepnutí kamkoli do koláče vybere výseč podle úhlu
  a klepnutí doprostřed vrátí souhrn. Řádek pod koláčem na Výdajích
  (`data-pod`, `donuts[id].pod`) se přepíná s prostředkem: bez výběru
  o celém cyklu, s vybranou výsečí o její kategorii.

- **Dlaždice s čísly** (`.tile`) mají číslo dole (`margin-top:auto`),
  ať v řadě sedí všechna ve stejné výšce, i když se popisek zalomí.
  Datové pole na iPhonu (`input[type=date].inp`) má `appearance:none`,
  jinak si drží vlastní minimální šířku a v půlce řádku přetékalo přes
  vedlejší pole (Přesun z účtu).

- **Spodní lišta a plusko na telefonu** (29. 9. 2026): viewport má
  `viewport-fit=cover` a lišta si dole bere `env(safe-area-inset-bottom)`,
  jinak se na iPhonu lepila na zaoblení displeje a pruh pro přejetí
  domů. Mobilní `.fab` a `.toast` stojí **za** obecnými pravidly
  (stejná specificita, vyhrává pozdější): uvnitř horní mobilní sekce je
  obecné `.fab{bottom:22px}` přebilo, plusko sedělo přes „Více" a lišta
  nad ním chytala klepnutí.

- **Prohlídka appky bublinami** (`prohlidkaStart`, `tourSeznam`,
  `tourPos`, 2. 10. 2026): devět kroků přes hlavní číslo, Zápis, každou
  záložku a Nastavení. Spustí se sama jen v čerstvé prázdné appce
  (`S.ui.tourDone`, `migrate` ho u stávajících dat nastaví na true),
  jinak tlačítkem v Nastavení. Ztmavení je vrstva s vyříznutým otvorem
  (`clip-path`), ne obří stín. Stejný kód jako v Můj budget, podrobnosti
  v `mujrozpocet/CLAUDE.md`.
- **Pojmy jen odborné** (hypotéka, úvěr, spořicí účet), ne „půjčka od
  rodičů" ani „spořák": pravidlo z manuálu značky, oddíl 8.
- **Dlaždice s čísly se musí vejít** (`tilesFit`, `.mrow`, `.tiles`):
  sloupce `minmax(0,1fr)`, při přetečení se zmenší písmo v celé řadě.
  Dřív dlouhé číslo roztáhlo na mobilu celou stránku do strany.

- **`fm()` zaokrouhluje na celé koruny, `fmEx()` ne.** Na částky, které si
  uživatel sám nastavil (plán u položky s `fixAmt`), se používá `fmEx` —
  jinak by viděl „329 Kč" tam, kde zadal 329,35. Jinde zaokrouhlení nevadí.

- **Výdaj patří do období podle svého data, ne podle otevřeného cyklu.**
  `periodForDate()` + `logToDate()` — používá to `quickAdd`, `addLog`,
  `payFixed` i `saveLog`. Když datum spadá do jiného období, kategorie a
  položka se tam najdou **podle názvu** (id je v každém období jiné) a
  případně založí; přenese se `link`, `kind` i `fixAmt`. Konec období je
  výlučný (`from<=d<to`), protože nové období začíná dnem `to` toho
  předchozího. Datum mimo všechna období → zůstane v otevřeném.
  Tím je sjednocené i to, že splátky dluhů se řadily podle data, ale
  obálky a investice podle `pid` — `pushLinked` dostává `pid` cílového
  období.

- **Změna propojení musí přerovnat i to, co je zapsané** (`saveItemCfg`).
  Když se u položky přepne `link` z jednoho dluhu na druhý, projdou se
  všechny její zápisy: `removeLinked(le.id)` je sundá ze starého cíle a
  `pushLinked` je nasype do nového. Bez toho splátky zůstaly viset u
  původního dluhu a k novému se nepřidaly — oba dluhy pak ukazovaly
  špatný zůstatek napořád (nalezeno a opraveno 19. 8. 2026 při kontrole
  kódu). Platí i pro zapnutí propojení u položky, co už zápisy má, a pro
  jeho zrušení. Uložení bez změny propojení nesmí nic duplikovat.

- **Zápis jde opravit, ne jen smazat** (`logModal`/`saveLog`). U propojené
  položky se starý záznam odebere (`removeLinked`) a založí nový, jinak by
  v dluhu zůstala stará částka. Změna data zápis rovnou přesune do
  správného období.

- **Pevné platby** (`fixedBlock`) na Přehledu: seznam položek s `fixAmt`,
  u každé tlačítko Zaplatit. **Po jedné, nikdy hromadně** — viz pravidlo
  o bulk operacích výš. Zaplaceno = má v cyklu aspoň jeden zápis.
  **Tlačítko se schová, když otevřený cyklus není ten, do kterého patří
  dnešek.** `payFixed` zapisuje přes `logToDate` podle dnešního data, ale
  stav „zaplaceno" se čte z otevřeného cyklu — když se lišily, platba
  spadla jinam, řádek dál nabízel Zaplatit a šlo ji zaplatit několikrát
  (nalezeno a opraveno 20. 8. 2026). `payFixed` navíc odmítne zápis,
  když už v cyklu jeden je.

- **Kurz krypta se stahuje sám** (`autoPriceRefresh`) při startu appky a
  při návratu do okna, max jednou za 10 minut, jedním dotazem na všechny
  mince. Bez připojení se prostě nic nestane. **Zhodnocení se sbírá do
  jednoho `hist` záznamu za den** (`applyMarketValue`, příznak `auto`) —
  jinak by historie za měsíc měla stovky řádků a graf jmění z nich
  stejně bere jen denní bod. Když se kurz vrátí zpátky, dnešní záznam se
  vynuluje a zmizí. `inv.pxAt` drží čas posledního stažení, kvůli
  „kurz sám před 5 min" na kartě.
  **Denní kurzové záznamy se v seznamu historie na kartě neukazují**
  (filtr na `!x.auto`) — jsou jen podklad pro graf jmění, který by bez
  nich ukazoval dnešní hodnotu i do minulosti. Místo nich je na kartě
  `invTrend()`: o kolik s tím hnul trh za 30 dní a za rok, počítané jen
  ze záznamů `k:'gain'` (vlastní vklady výsledek nezkreslí). Okno se
  schová, když investici tak dlouho ještě nemáš.

- **Porovnání dvou libovolných období** (`statCompare`, záložka Porovnat).
  `cmpPrev` a `statCompare` sdílí `cmpCatRows`/`cmpRowsHtml`. Různě dlouhé
  cykly se **nepřepočítávají na den** — jen se to napíše; u nepravidelných
  výplat by přepočet mátl víc, než pomohl.

- **Proti minulému cyklu** (`cmpPrev`) ve Statistikách u aktuálního cyklu.
  Kategorie se páruje podle názvu. Když cyklus ještě běží, je to napsané —
  půlka cyklu proti celému by jinak vypadala jako úspora.

- **Rozbalená položka je na zapisování, ne na nastavování.** Uvnitř zůstává
  jen historie a řádek datum/poznámka/částka/+. Název, plán, pevná částka,
  propojení a 50/30/20 jsou v `itemModal()` pod tlačítkem „Nastavení
  položky". Dřív to bylo všechno nasypané pod sebou a uživatel nahlásil, že
  se v tom ztrácí a bojí se, že omylem přepíše něco jiného. **Nevracet
  nastavovací prvky mezi zápisy.** Modal navíc ukládá až na Uložit
  (`saveItemCfg`), ne po každém poli — právě proto, aby šlo couvnout.

- **Vysvětlivky jdou vypnout, varování ne.** Tutoriálové bannery nahoře na
  záložkách (obálky, investice, dluhy, nastavení) chodí přes `tipBan()` a
  skryje je `S.ui.hideTips` (Nastavení → Přizpůsobení). Uživateli jich přišlo
  moc. **Přes `tipBan()` nikdy neposílat varování ani stavové hlášky** —
  výpadek cloudu, ochrana dat, připomínka připojovacího kódu a stav úložiště
  musí být vidět i s vypnutými vysvětlivkami. Je to oddělené od
  `S.ui.hideIntro`, což je průvodce začátkem na Přehledu.

- **Logo a ikona v záložce se řídí grafickým manuálem Můj budget**
  (`~/Documents/GitHub/mujrozpocet/znacka/MANUAL.md`). Logo je jedno:
  vzor ze záhlaví mujbudget.cz, v kódu konstanta `LOGO_CORE`, doslova
  stejná jako `znacka/logo.svg`. Záhlaví (`logoSVG()`), ikona v záložce
  (`applyFavicon`, data URL z `LOGO_FILE`) i ikona na ploše (PNG přes
  canvas z plné varianty bez zaoblení) jsou tentýž vzor. **Nepřebarvuje
  se podle `S.ui.accent`** a nemá žádnou tučnou „malou" variantu; obojí
  bylo a Patrik to 28. 9. 2026 vrátil. Logotyp 38 / 22 / 11 i na mobilu.
  Kontrola `python3 tools/kontrola-znacky.py` v repu mujrozpocet hlídá
  i tenhle soubor, když leží vedle. Titulek stránky se řídí
  `S.ui.appName`, vlastní název stojí vedle loga celý v barvě textu.

- **Ikony jsou z knihovny Lucide** (lucide.dev, ISC licence), vložené přímo
  v `ICON` mapě v kódu (ne CDN). `svg.i{display:inline-block}` — POZOR, dřív
  bylo `display:block` a ikony uprostřed věty (`${ic('percent',12)} text...`)
  se lámaly na vlastní řádek a v malé velikosti vypadaly jako osamocené znaky
  (nahlášeno jako „záhadné %"). Nikdy nevracet na `display:block` globálně.

- **Font čísel** je volitelný (Nastavení → Přizpůsobení), výchozí Bahnschrift,
  ukládá se do `S.ui.numFont`, aplikuje se přes CSS proměnnou `--numfont`.

- **Obnova ze zálohy musí být „nejnovější" a jít do cloudu** (`importFile`,
  opraveno 2. 10. 2026). Dřív se obnovený stav jen uložil v zařízení se
  starým `mt` ze souboru a první synchronizace ho přepsala tím, co bylo
  v cloudu, takže obnova potichu zmizela. Teď `pushBackup()`,
  `S.mt=Date.now()` a `schedulePush()`. Prázdná záloha se neobnoví vůbec.
  Stejná záloha jde obnovit v Můj budget (přesun dat, viz
  `mujrozpocet/CLAUDE.md`); akcie a ETF se tam vedou ručně.

- **Úprava zápisu umí změnit kategorii a položku** (`logModal`,
  `logModalPol`, `logModalLink`, `saveLog`; Patrik 5. 10. 2026). Po změně
  kategorie se položka nepředvybírá, stejně jako v Zápisu. Propojení se
  přerovná samo: starý odraz v dluhu, obálce nebo investici zmizí
  (`removeLinked`) a nová položka si případně založí svůj (`pushLinked`
  přes `logToDate`). Dialog to předem napíše.
- **Vybraný účet zúží Pohyby na Přehledu** (`pohAcc`). Klik na účet
  v pruhu nad hlavním číslem dál nastavuje účet pro nové zápisy, a k tomu
  Pohyby ukážou jen jeho pohyby, s plusem a mínusem ze strany účtu
  (`accSign`) jako výpis z banky. „všechny účty" v nadpisu výběr zruší.

- **Přesun má Kam a vrácení z obálky snižuje odloženo** (Patrik
  5. 10. 2026). Přesun (zpět na účet) dřív připsal peníze jen na účet
  vybraný nahoře na Přehledu, a bez něj nikam. Teď se cílový účet vybírá
  v panelu (`zapisKam`, na dotyku štítek v kroku Kolik); když účty
  existují a žádný vybraný není, nic se nezapíše. Vrácení z obálky na
  účet dostane `zpet:true` a `savedInPeriod` ho odečte, stejně jako
  výběr z investice odjakživa snižuje `investedInPeriod`: peníze jsou
  zase volné a „zbývá volných" o ně vzroste. **Čerpání** z obálky na
  výdaj se dál nepočítá (sinking fund). Starší vrácení příznak nemají
  a zůstávají, jak byla.

- **Barvy u úspor** (`stavBarva`, položky, řádky kategorií, koláč;
  Patrik 5. 10. 2026: „proč je to žluté"). U výdajů je nad 85 % plánu
  zlatá a přes plán červená. U úspor (kategorie nebo položka typu
  `save`) je splněný i překročený plán zelený a pod názvem stojí
  „o X víc", ne „přes o X".
- **Nové období plusem v hlavičce.** Na posledním období je místo
  vypnuté šipky vpřed tlačítko plus (`.period .nav.novy`), které otevře
  `newPeriodModal`. Dřív šlo jen přes Nastavení a banner po konci
  cyklu a Patrik ho musel hledat.

## Nástrahy při editaci/testování

- **Read/Grep tool občas zobrazí `/` jako `\`** ve výstupu (vizuální artefakt,
  ne skutečný obsah souboru). Když `old_string` v Edit nesedí a diff vypadá
  jako by tam byl `\` místo `/`, ověř přesný obsah přes `Grep` s escapovaným
  vzorem (`Math.round\(x\.y\*100\)` apod.) než měnit cokoliv — soubor je
  pravděpodobně v pořádku.
- **Česká čísla mají v `Intl.NumberFormat` úzkou nedělitelnou mezeru** (U+00A0,
  ne obyčejnou mezeru) — naivní `.replace(/[ ]/g,' ')` v testovacích skriptech
  to nezachytí a hlásí falešné „neshody". Ověřuj vizuálně přes `innerText`
  nebo přímo přes `fm(cislo)` v konzoli, ne přes regex se zalomenými mezerami.
- Vždy spustit **automatizovaný test v Browseru** (vytvořit testovací stav
  `S`, zavolat funkce, ověřit výstup) před commitem — user opakovaně objevil
  reálné logické chyby (LTV základ, obálky počítané do cyklu, dvojí modal),
  které testy odhalily.

## Co zbývá / další nápady (odsouhlaseno uživatelem, zatím neuděláno)

- **Dávka 2 je hotová (18. 8. 2026), nic otevřeného nezbývá.** Zbytek
  sekce je jen kontext pro další nápady.
- Uživatel má rád: teplý/klidný design (ne tmavý), SVG ikony (ne emoji),
  věci co nejvíc automatické ale transparentní (vidět PROČ se číslo počítá).
- Priorita #1 napříč celým projektem: **nikdy neztratit data** — dnes to
  stojí na Cloudflare Workeru (+ denní verze), kopiích ve třech
  prohlížečích, GitHubu pro kód a export/importu v appce.
  **Hotové, nevracet se k tomu:** krypto s auto kurzem, přesun sync ze
  Supabase na Cloudflare, pojistka proti přepsání prázdným stavem,
  hlasitý banner při výpadku cloudu, denní verze s obnovením,
  graf vývoje jmění, investiční kalkulačka, odstranění Supabase kódu.
  **Odpadlo:** „vypnout registrace v Supabase" — Supabase se už nepoužívá.

## Graf vývoje jmění (`nwAt` / `nwSeries` / `nwChart`)

Na Statistikách pod Čistým jměním, oba podpohledy. **Nic se neukládá** —
minulost se dopočítá zpětně: dnešek je známý přesně z `totalInvest()` /
`totalEnvelopes()` / `debtRemaining()` a od něj se odečtou pohyby, které
přišly potom. Díky tomu poslední bod grafu **vždycky** sedí s dlaždicemi
nad ním; to je invariant, na kterém stojí důvěryhodnost grafu, a je
otestovaný. Kdo bude sahat do `nwAt`, musí ho udržet.

Do zůstatků patří i `adj:true` a `src` záznamy — do rozpočtu cyklu se
schválně nepočítají, ale zůstatek fakt změnily, takže do jmění patří.
Dvě ošklivá data se ohýbají, jinak by poslední bod nesedl: pohyb
s **budoucím datem** se počítá jako dnešní, pohyb **bez data** patří do
počátečního zůstatku.

Přepínač Čisté jmění / Investice / Obálky / Dluhy, každá složka má
**vlastní měřítko** — s hypotékou v milionech by se pohyb investic
v desetitisících srovnal do rovné čáry. Neslučovat do jedné osy.

## Investiční kalkulačka (`invCalc` / `invCalcModal`)

Na Investicích vedle Nové položky. Čistě „co kdyby", **nesahá na data**.
Úrok měsíčně, vklad na konci měsíce, daň průběžně z úroku — schválně
stejně jako `creditInterest()`, ať appka nepočítá dvěma způsoby.
Ověřeno proti uzavřenému vzorci pro anuitu.
