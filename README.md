# Segnalazioni sentieri CAI Bologna

Servizio per i volontari della sentieristica del CAI Bologna «Mario Fantin»: caricamento di foto con posizione GPS, approvazione da parte degli amministratori, mappa riservata. Il brief completo è in [CLAUDE.md](CLAUDE.md).

**Stato:** passi 1 e 2 (accesso e caricamento). Accesso con Google `@caibo.it` e ruolo dal foglio; il volontario sceglie foto e ZIP, vede posizione e avvisi e le invia su Drive (con riga nel foglio). La dashboard admin è ancora vuota.

## Struttura

- `public/`: pagina web (HTML, CSS e JavaScript semplice, nessun bundler).
- `api/`: funzioni Vercel. `api/me.js` verifica l'accesso e risponde con ruolo e nome.
- `api/_lib/auth.js`: verifica dell'ID token e del ruolo. **Ogni funzione nuova va esportata con `protetto([...ruoli], gestore)`**, così il controllo dei permessi avviene sempre sul server.
- `api/_lib/sheets.js`: lettura e aggiunta di righe nel foglio con l'account di servizio. `api/_lib/drive.js`: Drive. `api/_lib/sessione.js`: biglietto di sessione firmato.
- `public/exif.js`, `public/carica.js`, `public/invio.js`: lettura GPS (JPEG/HEIC), vista «Carica foto» e invio.

## Ruoli

Letti dalla scheda `utenti` del foglio: `volontario` (vista «Carica foto»), `admin` e `super_admin` (vista «Dashboard»).

## Preparazione e avvio

1. Segui [SETUP.md](SETUP.md) per Google, Drive, foglio e Vercel.
2. In locale: `npm install`, copia `.env.example` in `.env.local`, compila i valori, poi `npx vercel dev` e apri <http://localhost:3000>.
3. Nessuna chiave o ID va scritta nel repository: solo variabili d'ambiente.
