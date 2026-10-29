# Segnalazioni sentieri CAI Bologna

Servizio per i volontari della sentieristica del CAI Bologna «Mario Fantin»: caricamento di foto con posizione GPS, approvazione da parte degli amministratori, mappa riservata. Il brief completo è in [CLAUDE.md](CLAUDE.md).

**Stato:** passi 1, 2, 3 e 4 (accesso, caricamento, dashboard, mappa). Accesso con Google `@caibo.it` e ruolo dal foglio; il volontario sceglie foto e ZIP, vede posizione e avvisi e le invia su Drive (con riga nel foglio). Gli amministratori vedono le foto con miniatura, autore e posizione e le approvano o rifiutano (anche in blocco).

## Struttura

- `public/`: pagina web (HTML, CSS e JavaScript semplice, nessun bundler). `public/vendor/`: librerie copiate nel repository (fflate, Leaflet).
- `api/`: funzioni Vercel.
  - `api/me.js`: configurazione per la pagina di accesso e «chi sono». `api/sessione.js`: dopo l'accesso con Google rilascia (e rinnova) il biglietto di sessione del sito.
  - `api/etichette.js`: tipi di problema attivi (scheda `etichette`) più «Altro» per il menu del volontario; `api/admin/categorie.js`: gestione delle categorie da parte degli admin.
  - `api/carica/avvia.js` e `api/carica/conferma.js`: sessioni di caricamento su Drive e registrazione nel foglio (solo volontari).
  - `api/admin/foto.js`, `anteprima.js`, `revisione.js`, `mappa.js`, `categorie.js`: elenco, miniature, revisione, punti della mappa e categorie (solo admin e super_admin).
- `api/_lib/`: `auth.js` (verifica del biglietto o dell'ID token e del ruolo: **ogni funzione nuova va esportata con `protetto([...ruoli], gestore)`**, così il controllo dei permessi avviene sempre sul server), `sheets.js` (foglio Google), `drive.js` (Drive), `sessione.js` (biglietto firmato), `etichette.js`.
- Pagine: `public/app.js` (accesso e viste), `public/exif.js` (lettura GPS, JPEG e HEIC), `public/carica.js` e `public/invio.js` (vista «Carica foto» e invio), `public/dashboard.js`, `public/mappa.js` e `public/categorie.js` (vista admin).

## Ruoli

Letti dalla scheda `utenti` del foglio: `volontario` (vista «Carica foto»), `admin` e `super_admin` (vista «Dashboard»).

## Preparazione e avvio

1. Segui [SETUP.md](SETUP.md) per Google, Drive, foglio e Vercel.
2. In locale: `npm install`, copia `.env.example` in `.env.local`, compila i valori, poi `npx vercel dev` e apri <http://localhost:3000>.
3. Nessuna chiave o ID va scritta nel repository: solo variabili d'ambiente.
