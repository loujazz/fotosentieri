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

## Da verificare

- Posizione nelle foto scaricate da Google Foto con qualità "Risparmio spazio" attiva, e con iPhone.
- Lettura delle coordinate dei file HEIC.
- Apertura di ZIP grandi nel browser; limiti di memoria.
- Se tutti i volontari possono avere un account `@caibo.it`: licenze disponibili, creazione degli account, verifica in due passaggi.
- Conferma del CAI (`catastorei@cai.it`) su uso e frequenza dell'API.
- Informativa privacy per le foto e per i dati degli autori.
- Chi vede la mappa riservata: tutti gli account `@caibo.it` oppure solo admin e volontari abilitati.
