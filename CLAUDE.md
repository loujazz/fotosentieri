# Segnalazioni sentieri CAI Bologna: brief del progetto

*Documento di partenza per Claude Code. Versione 0.1, 28/10/2026. Da aggiornare a ogni decisione.*

## Obiettivo

I volontari della sentieristica del CAI Bologna "Mario Fantin" segnalano problemi sui sentieri (albero caduto, frana, segnavia rovinato) con foto. Il servizio deve:

1. far caricare le foto ai volontari nel modo più semplice possibile, **conservando la posizione GPS dentro il file**;
2. permettere a due amministratori di vedere anteprime, autore e posizione, e di approvare o rifiutare;
3. mostrare le foto approvate su una mappa riservata, insieme ai sentieri CAI (dati OSM2CAI / Infomont).

## Decisioni prese (28/10/2026)

- **Account:** solo account Google Workspace `@caibo.it`. Nessun account Gmail personale.
- **Archivio separato** da quello delle foto storiche di Fantin Maps: cartelle, dati e mappa propri.
- **Mappa riservata:** nessuna foto e nessuna miniatura pubblica; accesso solo con login `@caibo.it`.
- **Caricamento da computer**, con pagina web: il volontario scatta con il telefono, le foto salgono su Google Foto, a casa le scarica dal sito di Google Foto (spesso come ZIP) e le carica qui.
- **Perché da computer:** da una pagina web aperta dal telefono, Android toglie la posizione dalle foto; da un browser desktop la posizione resta (verificato).
- **Nessuna correzione manuale della posizione da parte del volontario** come percorso normale. Le foto senza GPS vengono segnalate al volontario prima dell'invio e in evidenza agli admin. Correzione manuale solo da admin (da confermare).
- **Sincronizzazione automatica** con OSM2CAI, non manuale (vedi sotto).
- Stack: JavaScript semplice, Leaflet, Vercel (come Fantin Maps). Nessun costo ricorrente, ecosistema Google.

### Decisioni successive

- **28/10/2026, ruoli:** la colonna `ruolo` della scheda `utenti` ha tre valori: `volontario`, `admin`, `super_admin` (nessuna colonna separata). `super_admin` vede la stessa dashboard di `admin`; la gestione di utenti e ruoli è riservata a lui (da costruire).
- **28/10/2026, account di servizio:** la chiave sta in un'unica variabile `GOOGLE_SERVICE_ACCOUNT_JSON` con tutto il JSON; il codice gestisce gli a-capo della `private_key`.
- **28/10/2026, scheletro:** il browser legge il client ID da `GET /api/me?config=1` (senza token). Ogni funzione in `api/` si esporta con `protetto([...ruoli], gestore)` (`api/_lib/auth.js`). Nessun `vercel.json` per ora.
- **28/10/2026, documenti nel repository:** in `docs/` ci sono la specifica OpenAPI di OSM2CAI, la procedura per i volontari e la pagina di test dell'EXIF; dall'ambiente di sviluppo non si raggiungono i server del CAI, quindi la specifica è la fonte per i passi sulla sincronizzazione.
- **28/10/2026, chiavi dell'account di servizio:** l'organizzazione `caibo.it` blocca la creazione di chiavi (policy `iam.disableServiceAccountKeyCreation`, legacy). Il blocco è stato tolto **solo per il progetto** `segnalazioni-sentieri` (policy del progetto con override, applicazione disattivata). In alternativa più sicura, da valutare in futuro: federazione delle identità per i workload, senza chiavi scaricate.
- **28/10/2026, foglio dati:** deve essere un vero Foglio Google nel Drive condiviso (un `.xlsx` caricato va convertito con «Salva come Fogli Google»). `SHEET_ID` è solo la parte dell'indirizzo tra `/d/` e `/edit` (circa 44 caratteri). In caso di errore di lettura il server scrive nei log una riga `Diagnostica foglio:` con motivo, email del robot e inizio/fine dell'ID.
- **28/10/2026, lettura EXIF:** parser proprio senza librerie in `public/exif.js` (JPEG e HEIC), che non lancia eccezioni: un file illeggibile torna con `errore` valorizzato, mai in silenzio. Coordinate 0,0 trattate come posizione assente. La data di scatto è l'ora locale del telefono, senza fuso.
- **28/10/2026, ZIP e elenco di caricamento (pezzo 2b):** libreria `fflate` 0.8.2 (MIT) copiata in `public/vendor/fflate.min.js`, nessuna dipendenza esterna a runtime. Lo ZIP si legge a pezzi da 4 MB; si tengono solo JPEG e HEIC (si scartano altri file, cartelle e file di servizio dei Mac, contando quelli scartati). Limite di 1,5 GB di foto estratte per volta, oltre il quale si chiede di dividere. Una foto senza posizione o illeggibile non blocca: è segnalata al volontario con un testo chiaro (da inviare comunque, in evidenza agli admin, come da decisioni iniziali). Stessa foto (nome e dimensione) già in elenco: ignorata. L'anteprima dell'HEIC non è ancora disponibile (segnaposto): conversione solo per la visualizzazione da decidere (richiede una libreria WebAssembly).
- **28/10/2026, sessione (pezzo 2c):** dopo l'accesso con Google il server rilascia un biglietto firmato (HMAC-SHA256, variabile `SESSION_SECRET`) con prefisso `cai1.`, valido 12 ore e rinnovabile con `POST /api/sessione` (la pagina lo rinnova da sola quando mancano meno di 2 ore) fino a 7 giorni dall'accesso con Google. Contiene solo l'email: ruolo e abilitazione si rileggono dal foglio a ogni richiesta, quindi una disattivazione vale subito. Sostituisce la sessione di un'ora senza rinnovo.
- **28/10/2026, invio su Drive (pezzo 2c):** `POST /api/carica/avvia` (solo `volontario`) crea sessioni di caricamento resumable sul Drive condiviso, cartella `Da approvare`, passando l'origine del sito (necessaria per il caricamento dal browser); il browser invia l'originale con una PUT per foto (2 in parallelo, fino a 3 tentativi, ogni tentativo con sessione nuova: non si riprende a metà file). `POST /api/carica/conferma` controlla ogni file (cartella, proprietario tramite impronta dell'email in `appProperties`, tipo), **rilegge posizione e data dal file su Drive** con lo stesso `exif.js` (non si fida del browser) e aggiunge le righe a `invii` e `foto` senza duplicare (ripetibile). Scope Drive dell'account di servizio: `drive.file` (solo file creati da lui). Foto non leggibili non si inviano; foto senza posizione sì (campi posizione vuoti). Settore, sentiero ed etichetta restano vuoti fino al passo 5; la data del sopralluogo è precompilata dalla prima foto e modificabile.
- **28/10/2026, dashboard admin (passo 3):** `GET /api/admin/foto` (stato in_attesa/approvata/rifiutata; le 200 più recenti, con autore dalla scheda `invii` e conteggi), `GET /api/admin/anteprima` (miniatura di Drive, `piccola` 400 px o `grande` 1600 px, letta con l'account di servizio dopo il controllo del ruolo, `Cache-Control: private`; la pagina la scarica con il biglietto di sessione e la mostra come oggetto del browser, mai un indirizzo pubblico; l'id del file su Drive si legge dal foglio, mai dalla richiesta) e `POST /api/admin/revisione` (da 1 a 100 foto; approva = file in `Approvate`; rifiuta = motivo obbligatorio, max 500 caratteri, file in `Scartate`; poi nel foglio `stato`, `rivista_da`, `rivista_il`, `motivo_rifiuto` solo nelle celle interessate, mai riscrittura della scheda). Si rivedono solo le foto `in_attesa`. Lo spostamento su Drive è ripetibile: se il foglio non si aggiorna, un secondo tentativo completa il lavoro. Il foglio si legge con valori non formattati (numeri col punto decimale, anche con impostazioni italiane). Pagina con schede, filtro «solo senza posizione», selezione multipla con conferma, avviso sulle foto senza posizione che non andranno sulla mappa, foto ingrandita. Correzione della posizione da parte dell'admin: rimandata al passo della mappa (decisione del 28/10/2026). Nessuna funzione per annullare una revisione (da decidere).

## Ruoli

- **Volontario:** vede solo "Carica foto" e l'elenco dei propri invii.
- **Admin** (due persone, uno è super admin): dashboard di approvazione, mappa, gestione utenti e ruoli.
- Un solo indirizzo web; dopo il login la vista dipende dal ruolo, letto da un foglio Google.
- **Tutti i controlli di permesso vanno fatti sul server**, non solo nel browser.

## Architettura

- **Login:** Google Sign-In con ID token verificato lato server; accettare solo il dominio `caibo.it`. Schermata di consenso OAuth di tipo **Interno**. Permessi minimi (email, profilo); nessuno scope Drive per gli utenti.
- **Drive e Fogli:** accesso solo tramite **account di servizio**, dalle funzioni Vercel.
- **File:** in un **Drive condiviso** del CAI, cartelle `Da approvare`, `Approvate`, `Scartate`. Nessun file pubblico per link.
- **Caricamento:** il browser invia i file direttamente a Drive con una sessione di upload ripristinabile (resumable) creata dal server; il server registra poi la riga nel foglio. Le foto vengono inviate **originali**, con l'EXIF intatto. Niente ricompressione.
- **Anteprime:** servite da una funzione del server, dopo il controllo del ruolo.
- **Dati:** un foglio Google con una riga per foto (aggiunte, mai riscrittura dell'intero contenuto) e schede per utenti/ruoli, invii, etichette, configurazione. Non usare un unico JSON riscritto per intero.
- **ZIP:** aperto nel browser (libreria JS), si scartano i file che non sono immagini, si leggono i metadati, si mostra l'elenco con anteprime prima dell'invio.
- **Formati:** JPEG (Android) e HEIC (iPhone). Leggere la posizione anche dai file HEIC; per l'anteprima nel browser convertire solo per la visualizzazione.

## Dati da salvare

**Per invio:** volontario, data del sopralluogo (precompilata dalla data di scatto, modificabile), settore, sentiero.

**Per foto:** id del file su Drive, latitudine e longitudine, fonte della posizione (EXIF o correzione admin), data di scatto, etichetta (albero caduto, frana, ...; l'elenco è modificabile da foglio), nota, stato (in attesa, approvata, rifiutata), chi ha rivisto e quando, motivo del rifiuto.

## Sentieri CAI: sincronizzazione con OSM2CAI

- Usare l'**API ufficiale documentata** di OSM2CAI (server `https://osm2cai.cai.it`, contatto `catastorei@cai.it`, sola lettura, senza autenticazione dichiarata). Endpoint utili: `/api/v3/sectors/list` e `/api/v3/sectors/{id}` (settori, filtro `bbox`), `/api/v2/hiking-routes/bb/{bbox}/{sda}` e `/api/v2/hiking-routes/region/{regione}/{sda}` (ID con data di aggiornamento), `/api/v2/hiking-route/{id}` (dettaglio con numero, partenza, arrivo), `/api/v2/hiking-routes-collection/bb/{bbox}/{sda}` (GeoJSON).
- **Non dipendere** da endpoint non documentati (`elasticsearch`, tile `.pbf`) se non come ripiego.
- **Sincronizzazione notturna automatica**: confronto delle date `updated_at`, scarico solo di ciò che cambia, salvataggio dei dati sincronizzati; menu e mappa leggono questi dati. Pulsante "Aggiorna ora" per gli admin. Se la sincronizzazione fallisce, si usa l'ultima copia e si avvisano gli admin.
- Per la mappa, SDA = 4 (validati). Richieste per bbox piccole e distanziate: in Fantin Maps l'area grande dava errore e il blocco 429.
- **Menu a tendina** settore → sentiero. L'elenco può essere largo: il volontario riconosce il proprio sentiero. Aggiungere ricerca per numero.
- Attribuzione obbligatoria (ODbL): «© CAI - INFOMONT, derivati da OpenStreetMap. Disponibili con licenza ODbL».

## Riuso da Fantin Maps

Repository privato `loujazz/FantinMaps`. **Usare il branch di produzione**, non quello di lavoro, che è indietro.

- **Da riusare (copiare e adattare):** mappa Leaflet con cluster e popup, scheda di revisione con azioni di massa, parser EXIF (da estendere a HEIC), schema del flusso `in_attesa` / `approvata` / `rifiutata`, ricerca e disegno dei sentieri OSM2CAI, notifica via email (Apps Script).
- **Da NON riportare:** file resi pubblici per link, scope Drive completo, controlli di permesso solo nel browser, database come JSON unico riscritto, errori silenziosi nei caricamenti (`catch` che restituiscono vuoto e poi salvano), sessione di un'ora senza rinnovo, `@caibo.it` scritto nel codice, monolite da 3000 righe.
- **Da costruire:** ZIP, HEIC, campi della segnalazione, layer sentieri completo sincronizzato, gestione degli errori e delle quote di Drive, autorizzazione lato server.

## Modo di lavorare

- Passi piccoli, con conferma prima di azioni importanti.
- Codice completo e pronto da usare, non frammenti.
- Spiegazioni e interfaccia in italiano; l'interfaccia deve essere semplice per persone poco pratiche (pochi pulsanti, testi chiari, grandi).
- Nessuna chiave, ID o segreto nel repository: usare variabili d'ambiente e un file `.env.example`.
- Dopo ogni modifica indicare come verificarla a mano.

## Ordine di costruzione

1. Scheletro: login `@caibo.it`, ruolo letto dal foglio, due viste vuote, checklist di configurazione.
2. **Caricamento** (la parte rischiosa): foto e ZIP, lettura GPS (JPEG e HEIC), segnalazione foto senza posizione, invio su Drive, riga nel foglio.
3. Dashboard admin: anteprime, autore, stato della posizione, approva e rifiuta.
4. Mappa riservata con le foto approvate.
5. Dati del sopralluogo: data, settore, sentiero, etichette; sincronizzazione OSM2CAI e layer sentieri.
6. Prova con 3-5 volontari, Android e iPhone.

## Verificato

- Da Android, una pagina web aperta dal telefono perde la posizione; da iPhone dipende dall'opzione Posizione nel selettore.
- Foto scaricata da Google Foto sul computer e letta dal browser desktop: posizione conservata.
- L'app Drive (Android e iPhone) conserva la posizione, ma non è la strada scelta.
- L'API OSM2CAI ha documentazione ufficiale (Swagger, versione 1.0.0).
- 28/10/2026, scheletro (solo lato server, con Google simulato): ruoli `volontario`, `admin`, `super_admin`; rifiuto di utente non nel foglio, con `attivo` = `NO` o con ruolo non valido; rifiuto di dominio diverso da `caibo.it` (anche `caibo.it.evil.com` e Gmail); 401 senza token o con token non valido; lettura della `private_key` con a-capo normali, con doppio escape e con a-capo veri; errore 500 chiaro se il JSON è rotto.
- 28/10/2026, in produzione su Vercel (`https://fotosentieri.vercel.app/`): login reale con Google con account `@caibo.it`, consenso Interno, origine autorizzata, lettura reale del foglio con l'account di servizio, ruolo `super_admin` letto dalla scheda `utenti` e vista «Dashboard» mostrata.
- 28/10/2026, lettore GPS (`public/exif.js`) provato con file di prova generati da me, non con foto reali: JPEG con GPS (anche sud/ovest, quota sotto il mare, coordinate 0,0), JPEG con EXIF senza GPS, JPEG senza EXIF, JPEG troncato, PNG e file qualsiasi; HEIC creati con libheif (con GPS, senza GPS, senza EXIF, e uno da 5 MB). Provato sia da Node sia in Chromium con la pagina `public/test-exif.html`.
- 28/10/2026, prima prova con foto reali (da browser Chrome su Mac, pagina `test-exif.html`): una foto `IMG_*.jpg` e una `PXL_*.jpg` del 2020 con posizione letta correttamente; una `PXL_*.jpg` del 2026 senza posizione (metadati presenti); una seconda copia della stessa foto con blocco GPS non valido (dopo la prova: il lettore ora lo segnala come posizione assente con i valori grezzi, invece di dare errore).
- 28/10/2026, pagina «Carica foto» (`public/carica.js`), provata in Chromium con ZIP di prova miei: ZIP non compressi, compressi (deflate) e con descrittori di dati; cartelle, `__MACOSX` e file non foto scartati; ZIP con compressione non supportata, troncato, finto e senza foto (messaggi chiari, nessun errore in console); foto sciolte miste (con/senza posizione, senza EXIF, troncata, PNG); ZIP da 211 MB (30 foto) e da 1,2 GB (170 foto da 7 MB) aperti in circa 7 e 36 secondi; file singolo troppo grande per la memoria segnalato come «troppo grande» invece di «danneggiato».
- 28/10/2026, anteprima delle foto HEIC: visibile nel browser del responsabile (Mac); il browser la mostra se sa decodificare il formato.
- 28/10/2026, pezzo 2c provato **solo con Google simulato** (Sheets e Drive finti in locale, browser Chromium): biglietti di sessione (firma, scadenza, rinnovo, limite di 7 giorni, email di altro dominio), ruoli (un admin non può inviare), validazioni delle richieste, origine non valida, un volontario non può confermare file altrui né aggiungere a un invio altrui, ripetizione della conferma senza duplicati, posizione e data riletti dal file (JPEG e HEIC), file originali identici, guasto passeggero con nuovo tentativo, Drive pieno con messaggio chiaro, foglio non raggiungibile con riprova della sola registrazione senza ricaricare.
- 28/10/2026, pezzo 2c sul sito reale (`https://fotosentieri.vercel.app/`): il responsabile riferisce che login con biglietto di sessione e invio delle foto su Drive con registrazione nel foglio funzionano (non annotati i dettagli: numero di foto, ZIP o foto sciolte).
- 28/10/2026, dashboard admin provata **solo con Google simulato** (Sheets e Drive finti, Chromium): permessi (senza token 401, volontario 403 su tutte e tre le funzioni), elenco con autore e posizione come numeri, conteggi, miniature solo con il biglietto, richieste non valide, approvazione e rifiuto (foglio, cartelle e motivo ripulito), approvazione di massa con avviso e annullamento, foto già rivista da un altro admin, Drive che rifiuta lo spostamento (righe invariate), foglio non aggiornabile dopo lo spostamento e ripetizione senza errori.
- 28/10/2026, dashboard admin sul sito reale: il responsabile riferisce che funziona tutto (non annotati i dettagli su miniature, HEIC, numero di foto).

## Da verificare

- Posizione nelle foto scaricate da Google Foto con qualità "Risparmio spazio" attiva, e con iPhone.
- Lettura delle coordinate su foto HEIC e JPEG reali (iPhone e Android, anche scaricate da Google Foto): usare `public/test-exif.html` sul sito pubblicato. Mai provati: EXIF in big-endian, HEIC con più di un blocco di dati EXIF.
- ZIP reali scaricati da Google Foto (struttura, compressione, nomi) e apertura di ZIP grandi su computer reali (Mac e Windows, Chrome/Safari/Firefox): provato solo con ZIP di prova in Chromium su Linux, fino a 1,2 GB; limite di 1,5 GB scelto senza prove sui computer dei volontari.
- Anteprima delle foto HEIC su computer dove il browser non le decodifica (es. Windows senza estensione): oggi si vede un segnaposto; conversione solo per la visualizzazione da decidere.
- Se tutti i volontari possono avere un account `@caibo.it`: licenze disponibili, creazione degli account, verifica in due passaggi.
- Conferma del CAI (`catastorei@cai.it`) su uso e frequenza dell'API.
- Informativa privacy per le foto e per i dati degli autori.
- Chi vede la mappa riservata: tutti gli account `@caibo.it` oppure solo admin e volontari abilitati.
- Vista e permessi con un account `admin` e uno `volontario` (finora provato solo `super_admin`), e con un account non abilitato o con `attivo` = `NO`.
- Invio su Drive con molte foto (100+), ZIP reali di Google Foto, volontari con account diversi dal responsabile, quote e limiti reali di Drive (provato dal responsabile in piccolo, il resto solo con simulazioni).
- Rinnovo reale del biglietto di sessione dopo ore di uso e comportamento alla scadenza.
- Caricamento di 100+ foto reali e di file grandi su reti lente (riprova da capo per foto, nessuna ripresa a metà file).
- Miniature delle foto HEIC nella dashboard (se Drive le prepara) e di foto appena caricate; dettagli non annotati dopo la prova del responsabile.
- Dashboard con più di 200 foto per stato (oggi si vedono le 200 più recenti) e con due admin che lavorano insieme.

## Regola di lavoro
A fine di ogni sessione aggiorna questo file: sposta tra "Verificato" ciò che è
stato provato davvero, aggiorna "Da verificare" e scrivi le decisioni nuove con
la data. Non cancellare le decisioni precedenti, correggile se cambiano.
