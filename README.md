# Segnalazioni sentieri CAI Bologna

Servizio per i volontari della sentieristica del CAI Bologna «Mario Fantin»: caricamento di foto con posizione GPS, approvazione da parte degli amministratori, mappa riservata. Il brief completo è in [CLAUDE.md](CLAUDE.md).

**Stato:** passi 1, 2, 3 e 4 (accesso, caricamento, dashboard, mappa) e, del passo 5, tipo di problema, categorie e sincronizzazione con OSM2CAI. Accesso con Google `@caibo.it` e ruolo dal foglio; il volontario sceglie foto e ZIP, vede posizione e avvisi e le invia su Drive (con riga nel foglio). Gli amministratori vedono le foto con miniatura, autore e posizione e le approvano o rifiutano (anche in blocco).

## Struttura

- `public/`: pagina web (HTML, CSS e JavaScript semplice, nessun bundler). `public/vendor/`: librerie copiate nel repository (fflate, Leaflet).
- `api/`: **una sola funzione Vercel**, `api/ingresso.js`, che smista tutti gli indirizzi `/api/...` ai gestori in `api/_gestori/` (il piano Hobby ammette al massimo 12 funzioni e ogni file in `api/` ne conta una; le cartelle con il trattino basso non contano). **Per aggiungere un indirizzo nuovo:** crea il gestore in `api/_gestori/` e aggiungilo all'elenco in `api/ingresso.js`. I nomi qui sotto sono quelli dei gestori.
  - `me.js`: configurazione per la pagina di accesso e «chi sono». `sessione.js`: dopo l'accesso con Google rilascia (e rinnova) il biglietto di sessione del sito.
  - `sentieri.js`: menu settore → sentiero con i comuni (dati già sincronizzati); `etichette.js`: tipi di problema attivi (scheda `etichette`) più «Altro» per il menu del volontario; `admin/categorie.js`: gestione delle categorie da parte degli admin.
  - `carica/avvia.js` e `carica/conferma.js`: sessioni di caricamento su Drive e registrazione nel foglio (solo volontari).
  - `admin/foto.js`, `anteprima.js`, `revisione.js`, `mappa.js`, `categorie.js`, `settori.js`, `sync.js`: elenco, miniature, revisione, punti della mappa, categorie, settori e sincronizzazione con OSM2CAI (solo admin e super_admin).
  - `sync/cron.js`: un passo della sincronizzazione, chiamato ogni notte con `CRON_SECRET` (Vercel Cron, o un cron qualsiasi su un altro hosting).
- `api/_lib/`: `auth.js` (verifica del biglietto o dell'ID token e del ruolo: **ogni funzione nuova va esportata con `protetto([...ruoli], gestore)`**, così il controllo dei permessi avviene sempre sul server), `sheets.js` (foglio Google), `drive.js` (Drive e file di dati), `sessione.js` (biglietto firmato), `etichette.js`, `osm2cai.js` (client dell'API del CAI), `geometria.js` (semplificazione dei tracciati, punti in un poligono), `sincronizzazione.js` (sincronizzazione a piccoli passi).
- Pagine: `public/app.js` (accesso e viste), `public/exif.js` (lettura GPS, JPEG e HEIC), `public/carica.js` e `public/invio.js` (vista «Carica foto» e invio), `public/dashboard.js`, `public/mappa.js`, `public/categorie.js` e `public/sentieri.js` (vista admin).

## Ruoli

Letti dalla scheda `utenti` del foglio: `volontario` (vista «Carica foto»), `admin` e `super_admin` (vista «Dashboard»).

## Preparazione e avvio

1. Segui [SETUP.md](SETUP.md) per Google, Drive, foglio e Vercel.
2. In locale: `npm install`, copia `.env.example` in `.env.local`, compila i valori, poi `npx vercel dev` e apri <http://localhost:3000>.
3. Nessuna chiave o ID va scritta nel repository: solo variabili d'ambiente.

## Sincronizzazione con OSM2CAI e hosting

I dati dei settori e dei percorsi del CAI si salvano come file JSON nel Drive condiviso, non in servizi di Vercel. L'automatismo notturno è un indirizzo (`/api/sync/cron`) che qualunque pianificatore può chiamare con `Authorization: Bearer $CRON_SECRET`: su Vercel lo fa `vercel.json`; su un altro hosting basta un cron (per esempio `curl -H "Authorization: Bearer $CRON_SECRET" https://sito/api/sync/cron`) e si può togliere `vercel.json`. Ogni chiamata fa un passo di al massimo ~45 secondi (`SYNC_BUDGET_MS`); se il lavoro non è finito riprende alla chiamata dopo. I campioni delle risposte del CAI sono in `docs/osm2cai-esempi/`.
