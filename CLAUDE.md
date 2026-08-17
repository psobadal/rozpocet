# Můj rozpočet — kontext pro pokračování

Osobní rozpočtová appka od výplaty k výplatě pro Patrika. Jeden soubor
`index.html`, žádný build, žádné závislosti — otevře se dvojklikem nebo
na webu. Cílem je i „free appka pro kohokoliv" (viz README.md).

## Kde to žije

- **Lokálně:** `C:\Users\START\Downloads\Rozpočet\index.html`
- **GitHub:** [psobadal/rozpocet](https://github.com/psobadal/rozpocet) (veřejné repo, účet uživatele)
- **Živě na webu:** https://psobadal.github.io/rozpocet/ (GitHub Pages, větev `main`, root)
- **Synchronizace:** vlastní Worker na Cloudflare (`sync-worker.js` v repu, návod
  v `SYNC-SETUP.md`). Data v KV, přístup přes dlouhý tajný „sync kód" v hlavičce
  `X-Sync-Code` (klíč v KV je jeho SHA-256 otisk). Worker si drží jednu předchozí
  verzi (`prev:`) jako záchrannou brzdu. Adresa+kód žijí v localStorage pod
  `rozpocet-v2-sync`, **záměrně mimo `S`** — ať se tajný kód nedostane do exportu
  zálohy ani do dat nahraných do cloudu.
  **Proč ne Supabase:** free tier se po ~týdnu nečinnosti pozastaví a zmizí i
  z DNS — reálně se to stalo, přihlášení přestalo fungovat. Cloudflare Workers
  za nečinnost neusínají. Supabase kód v appce zůstal jen pro starší nastavení
  (`S.cloud`), `CONFIG.cloud` je prázdné, takže se ta sekce ani nezobrazí.

## Jak nasazovat změny

Po každé sadě úprav v `index.html`:
```powershell
git add index.html
git -c user.name='Patrik' -c user.email='obadal@aqe.cz' commit -F <soubor_se_zpravou>
$env:GIT_TERMINAL_PROMPT='1'; git push
```
Commit zprávu piš do dočasného souboru (heredoc/multi-line `-m` v PowerShellu
přes Bash tool dělá potíže s diakritikou) a commituj přes `-F`. Push spouštěj
na pozadí (`run_in_background: true`) — `git push` bez tohle prostředí hlásí
"terminal prompts disabled", proto `GIT_TERMINAL_PROMPT=1` a běh na pozadí.
GitHub Pages se aktualizuje samo do ~30 s po pushi.

**Vždy nejdřív otestuj v prohlížeči** (Browser tool, `javascript_exec` proti
otevřenému `index.html`) — appku lze celou ovládat/testovat přímo přes JS
konzoli (`S`, `go()`, `commit()`, všechny funkce jsou globální). Teprve po
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

- **Ikony jsou z knihovny Lucide** (lucide.dev, ISC licence), vložené přímo
  v `ICON` mapě v kódu (ne CDN). `svg.i{display:inline-block}` — POZOR, dřív
  bylo `display:block` a ikony uprostřed věty (`${ic('percent',12)} text...`)
  se lámaly na vlastní řádek a v malé velikosti vypadaly jako osamocené znaky
  (nahlášeno jako „záhadné %"). Nikdy nevracet na `display:block` globálně.

- **Font čísel** je volitelný (Nastavení → Přizpůsobení), výchozí Bahnschrift,
  ukládá se do `S.ui.numFont`, aplikuje se přes CSS proměnnou `--numfont`.

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

- **Dávka 2:** graf vývoje čistého jmění/investic v čase, investiční
  kalkulačka (složené úročení).
- **Vypnout registrace v Supabase** (aby si cizí lidi nemohli zakládat účty
  v projektu) — uživatel má obě zařízení už přihlášená, nedotkne se ho to.
- Uživatel má rád: teplý/klidný design (ne tmavý), SVG ikony (ne emoji),
  věci co nejvíc automatické ale transparentní (vidět PROČ se číslo počítá).
- Priorita #1 napříč celým projektem: **nikdy neztratit data** (proto
  Supabase sync + GitHub zálohy + export/import v appce).

## Odkaz na soutěž (jiný projekt, mimochodem)

`C:\Users\START\Downloads\LEGO Kódobraní\` — samostatný nesouvisející úkol
(Alza soutěž), má vlastní CLAUDE.md a KOD.md.
