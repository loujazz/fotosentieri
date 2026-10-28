# Preparazione fuori dal codice (SETUP)

Questa guida serve a preparare tutto ciò che il programma richiede **prima** di usarlo: Google, Drive, foglio e Vercel. Non servono competenze da sviluppatore: basta seguire i passi nell'ordine, spuntando le caselle.

**Regola d'oro:** i valori che copi (ID, chiavi) vanno nelle *variabili d'ambiente* di Vercel e, per le prove sul computer, nel file `.env.local`. **Mai** scriverli nel repository, in email o in chat.

Per tenere traccia, a ogni passo c'è una riga **«Copia → VARIABILE»**: dice cosa copiare e dove metterlo. Alla fine del documento c'è una tabella riassuntiva.

> Serve un account amministratore di Google Workspace del dominio `caibo.it` (per la schermata di consenso di tipo *Interno* e per creare il progetto dentro l'organizzazione).

---

## 1. Progetto Google Cloud

- [ ] Vai su <https://console.cloud.google.com> e accedi con l'account amministratore `@caibo.it`.
- [ ] In alto, accanto al logo, apri il selettore dei progetti → **Nuovo progetto**.
- [ ] Nome: `segnalazioni-sentieri`. **Organizzazione: `caibo.it`** (importante: serve per il consenso *Interno*). Premi **Crea**.
- [ ] Controlla che il progetto appena creato sia quello selezionato in alto.

## 2. Attivare le API di Drive e Fogli

- [ ] Menu ☰ → **API e servizi** → **Libreria**.
- [ ] Cerca **Google Drive API** → **Abilita**.
- [ ] Torna alla Libreria, cerca **Google Sheets API** → **Abilita**.

## 3. Schermata di consenso OAuth (tipo Interno)

- [ ] Menu ☰ → **API e servizi** → **Schermata di consenso OAuth** (in alcune versioni: *Google Auth Platform* → *Branding*).
- [ ] Tipo di utente: **Interno** (solo gli account `@caibo.it` potranno accedere). Premi **Crea**.
- [ ] Nome app: `Segnalazioni sentieri CAI Bologna`. Email di assistenza e contatto sviluppatore: un indirizzo `@caibo.it`.
- [ ] **Ambiti (scope):** aggiungi **solo** `.../auth/userinfo.email`, `.../auth/userinfo.profile` e `openid`. **Nessun ambito Drive o Fogli**: Drive e Fogli li usa solo l'account di servizio.
- [ ] Salva.

## 4. Client OAuth (per il pulsante «Accedi con Google»)

- [ ] Menu ☰ → **API e servizi** → **Credenziali** → **Crea credenziali** → **ID client OAuth**.
- [ ] Tipo di applicazione: **Applicazione web**. Nome: `Sito segnalazioni`.
- [ ] **Origini JavaScript autorizzate** (una per riga):
  - `https://NOME-DEL-PROGETTO.vercel.app` (l'indirizzo che Vercel ti darà al passo 8; se non lo conosci ancora, torna qui a completarlo)
  - l'eventuale dominio definitivo del sito, se ne userete uno proprio (facoltativo)
  - `http://localhost:3000` (prove sul tuo computer)
- [ ] **URI di reindirizzamento autorizzati:** il pulsante di accesso usato da questo progetto non ne ha bisogno. Per precauzione puoi inserire gli stessi due indirizzi (`https://NOME-DEL-PROGETTO.vercel.app` e `http://localhost:3000`), ma non è obbligatorio.
- [ ] Premi **Crea**. Compare una finestra con *ID client* e *Segreto client*.
- **Copia → `GOOGLE_CLIENT_ID`**: solo l'**ID client** (finisce con `.apps.googleusercontent.com`). Il *segreto client* non serve: non copiarlo da nessuna parte.

> Le modifiche alle origini possono impiegare alcuni minuti (a volte fino a un'ora) per diventare attive.

## 5. Account di servizio

È l'«utente robot» che il sito userà per leggere/scrivere su Drive e sul foglio. Gli utenti non avranno mai accesso diretto a Drive.

- [ ] Menu ☰ → **IAM e amministrazione** → **Account di servizio** → **Crea account di servizio**.
- [ ] Nome: `sentieri-robot`. ID: lascia quello proposto. **Crea e continua**.
- [ ] «Concedi l'accesso al progetto»: **non assegnare nessun ruolo** (salta). **Fine**.
- [ ] Apri l'account appena creato: nella scheda **Dettagli** copia l'**indirizzo email** (tipo `sentieri-robot@segnalazioni-sentieri.iam.gserviceaccount.com`). Servirà per dare i permessi ai passi 6 e 7.
- [ ] Scheda **Chiavi** → **Aggiungi chiave** → **Crea nuova chiave** → **JSON** → **Crea**. Si scarica un file `.json`.
- **Copia → `GOOGLE_SERVICE_ACCOUNT_JSON`**: apri il file `.json` con un editor di testo (Blocco note), seleziona **tutto il contenuto** (da `{` a `}`) e incollalo come valore della variabile.
- [ ] Dopo averlo incollato in Vercel, **cancella il file scaricato** dal computer (o conservalo in un posto sicuro, mai nel repository). Se pensi sia stato esposto, torna qui ed elimina la chiave, poi creane un'altra.

> Se la creazione delle chiavi è bloccata («Disable service account key creation»), un amministratore dell'organizzazione deve rimuovere quel criterio nel progetto: **IAM e amministrazione → Criteri dell'organizzazione**.

## 6. Drive condiviso con le cartelle

- [ ] Apri <https://drive.google.com> con un account `@caibo.it` → a sinistra **Drive condivisi** → **Nuovo**. Nome: `Segnalazioni sentieri` (archivio separato da Fantin Maps).
- [ ] Dentro il Drive condiviso crea tre cartelle con **esattamente** questi nomi: `Da approvare`, `Approvate`, `Scartate`.
- [ ] **Dare accesso all'account di servizio:** nel Drive condiviso, nome del drive → **Gestisci i membri** → aggiungi l'email dell'account di servizio (passo 5) con ruolo **Gestore dei contenuti**. Togli la spunta all'invio di notifiche se richiesto.
- [ ] **Non** attivare mai la condivisione «chiunque abbia il link» su drive, cartelle o file.

Come trovare gli ID:
- ID del Drive condiviso: apri il drive; nell'indirizzo del browser è l'ultima parte, `https://drive.google.com/drive/folders/`**`0AbCd…`**.
- ID di una cartella: apri la cartella; è la parte finale dell'indirizzo, dopo `/folders/`.

- **Copia → `DRIVE_ID`**: l'ID del Drive condiviso.
- **Copia → `FOLDER_DA_APPROVARE_ID`**: l'ID della cartella `Da approvare`.
- **Copia → `FOLDER_APPROVATE_ID`**: l'ID della cartella `Approvate`.
- **Copia → `FOLDER_SCARTATE_ID`**: l'ID della cartella `Scartate`.

## 7. Foglio Google con le schede

- [ ] **Dentro il Drive condiviso** `Segnalazioni sentieri` crea un nuovo **Foglio Google** chiamato `Segnalazioni sentieri - dati`. (Essendo nel Drive condiviso, l'account di servizio lo vede già grazie al passo 6. Se invece lo crei altrove, condividilo con l'email dell'account di servizio come **Editor**.)
- [ ] Crea **cinque schede** (le linguette in basso) con **esattamente** questi nomi, in minuscolo: `utenti`, `invii`, `foto`, `etichette`, `configurazione`.
- [ ] In ciascuna scheda scrivi le intestazioni **nella riga 1**, una per cella, a partire dalla colonna A, **esattamente come qui sotto** (minuscolo, con il trattino basso, senza accenti):

**Scheda `utenti`**

| A | B | C | D | E |
|---|---|---|---|---|
| `email` | `nome` | `ruolo` | `attivo` | `creato_il` |

- `ruolo`: solo `volontario` oppure `admin`.
- `attivo`: `SI` o `NO`. Chi ha `NO` (o non è nell'elenco) non entra.
- Per i primi prove aggiungi **tu** le righe: ad esempio la tua email `@caibo.it` con ruolo `admin`, e un'altra con ruolo `volontario`.

**Scheda `invii`** (una riga per ogni invio di foto)

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| `id_invio` | `email_volontario` | `nome_volontario` | `data_sopralluogo` | `settore` | `sentiero` | `data_invio` | `num_foto` |

**Scheda `foto`** (una riga per ogni foto; si aggiungono righe, non si riscrive il foglio)

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| `id_foto` | `id_invio` | `id_file_drive` | `nome_file` | `latitudine` | `longitudine` | `fonte_posizione` |

| H | I | J | K | L | M | N |
|---|---|---|---|---|---|---|
| `data_scatto` | `etichetta` | `nota` | `stato` | `rivista_da` | `rivista_il` | `motivo_rifiuto` |

- `fonte_posizione`: `EXIF` oppure `correzione_admin`.
- `stato`: `in_attesa`, `approvata` o `rifiutata`.

**Scheda `etichette`** (l'elenco delle etichette si modifica da qui)

| A | B | C |
|---|---|---|
| `etichetta` | `attiva` | `ordine` |

Righe iniziali suggerite (dalla riga 2): `albero caduto`, `frana`, `segnavia rovinato`, con `attiva` = `SI` e `ordine` = 1, 2, 3.

**Scheda `configurazione`**

| A | B |
|---|---|
| `chiave` | `valore` |

Righe iniziali suggerite: `email_avvisi_admin` con gli indirizzi degli admin separati da virgola (uso futuro).

- [ ] Ricava l'ID del foglio: nell'indirizzo del foglio è la parte tra `/d/` e `/edit`: `https://docs.google.com/spreadsheets/d/`**`1AbC…`**`/edit`.
- **Copia → `SHEET_ID`**: l'ID del foglio.

## 8. Nuovo progetto Vercel

- [ ] Vai su <https://vercel.com> e accedi (anche con GitHub).
- [ ] **Add New… → Project** → importa il repository `loujazz/fotosentieri`. Se non lo vedi, concedi a Vercel l'accesso a quel repository.
- [ ] **Framework Preset:** `Other`. Nessun comando di build, nessuna cartella di output da cambiare.
- [ ] Prima di premere **Deploy**, apri **Environment Variables** e inserisci le variabili della tabella qui sotto (per **Production**, **Preview** e **Development**). Si possono anche aggiungere o correggere dopo da *Settings → Environment Variables* (poi serve un nuovo deploy).
- [ ] Premi **Deploy**. Vercel mostra l'indirizzo (`https://NOME-DEL-PROGETTO.vercel.app`): **torna al passo 4** e verifica che sia tra le origini autorizzate.
- [ ] Per proteggere le anteprime di Vercel (deploy temporanei) lascia attiva la protezione di default; i test li facciamo con l'indirizzo di produzione.

### Variabili d'ambiente

| Variabile | Cosa metterci | Dove lo trovi |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ID client OAuth | passo 4 |
| `ALLOWED_DOMAIN` | `caibo.it` (solo il dominio, senza `@`) | lo scrivi tu |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | tutto il contenuto del file `.json` della chiave | passo 5 |
| `SHEET_ID` | ID del foglio Google | passo 7 |
| `DRIVE_ID` | ID del Drive condiviso | passo 6 |
| `FOLDER_DA_APPROVARE_ID` | ID della cartella `Da approvare` | passo 6 |
| `FOLDER_APPROVATE_ID` | ID della cartella `Approvate` | passo 6 |
| `FOLDER_SCARTATE_ID` | ID della cartella `Scartate` | passo 6 |

(Nello scheletro del passo 1 sono usate davvero solo le prime quattro e `SHEET_ID`; le variabili di Drive servono dal passo 2 in poi, ma conviene prepararle ora.)

## 9. Prove sul proprio computer (facoltativo, per chi sviluppa)

- [ ] Installa Node.js 20 o successivo e, nella cartella del progetto, esegui `npm install`.
- [ ] Copia `.env.example` in `.env.local` e compila i valori (il file `.env.local` non finisce mai su GitHub).
- [ ] Avvia con `npx vercel dev` e apri <http://localhost:3000> (la prima volta chiede di collegare il progetto Vercel).
- [ ] Verifica che `http://localhost:3000` sia tra le origini autorizzate (passo 4).

## Controllo finale

- [ ] Progetto Google Cloud creato nell'organizzazione `caibo.it`
- [ ] API Drive e Fogli abilitate
- [ ] Consenso OAuth di tipo **Interno**, solo ambiti `openid`, email, profilo
- [ ] ID client OAuth creato, con le origini giuste
- [ ] Account di servizio creato, chiave JSON copiata in Vercel e file cancellato
- [ ] Drive condiviso con le tre cartelle, account di servizio «Gestore dei contenuti», nessun link pubblico
- [ ] Foglio con le cinque schede e le intestazioni, almeno un admin e un volontario in `utenti`
- [ ] Progetto Vercel con tutte le variabili compilate
