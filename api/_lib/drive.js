// Accesso a Drive con l'account di servizio: sessioni di caricamento, verifica dei file arrivati
// e lettura dei primi byte (per rileggere posizione e data dal file vero).
const crypto = require('crypto');
const { ErroApi, variabile, clientGoogle } = require('./sheets');

const API = 'https://www.googleapis.com/drive/v3/files/';
const API_CARICAMENTO = 'https://www.googleapis.com/upload/drive/v3/files';
const TENTATIVI = 3;

const MOTIVI_SPAZIO = ['storageQuotaExceeded', 'driveStorageLimitExceeded', 'teamDriveFileLimitExceeded', 'cannotAddParent'];
const MOTIVI_LIMITE = ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded', 'sharingRateLimitExceeded'];

function pausa(ms) {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

// Converte un errore di Google in un errore del sito con un codice che la pagina sa spiegare.
function traduciErrore(errore, azione) {
  if (errore instanceof ErroApi) return errore;
  const stato = errore.response && errore.response.status;
  const dettaglio = errore.response && errore.response.data && errore.response.data.error;
  const motivi = ((dettaglio && dettaglio.errors) || []).map((e) => e.reason);
  console.error(`Drive: ${azione} non riuscito (HTTP ${stato || '?'}, ${motivi.join(',') || (dettaglio && dettaglio.status) || errore.message})`);
  if (motivi.some((m) => MOTIVI_SPAZIO.includes(m))) return new ErroApi(503, 'drive_pieno');
  if (stato === 429 || motivi.some((m) => MOTIVI_LIMITE.includes(m))) return new ErroApi(503, 'drive_limite');
  if (stato === 404) return new ErroApi(500, 'drive_non_trovato');
  if (stato === 403) return new ErroApi(500, 'drive_non_consentito'); // l'account di servizio non ha il permesso richiesto
  return new ErroApi(500, 'errore_drive');
}

// Richiesta con qualche nuovo tentativo per i guasti passeggeri (429, 5xx, rete).
async function chiedi(opzioni, azione) {
  const client = await clientGoogle();
  for (let tentativo = 1; ; tentativo++) {
    try {
      return await client.request(opzioni);
    } catch (errore) {
      const stato = errore.response && errore.response.status;
      const passeggero = !stato || stato === 429 || stato >= 500;
      if (!passeggero || tentativo >= TENTATIVI) throw traduciErrore(errore, azione);
      await pausa(400 * 2 ** (tentativo - 1));
    }
  }
}

function valoreIntestazione(intestazioni, nome) {
  if (!intestazioni) return undefined;
  return typeof intestazioni.get === 'function' ? intestazioni.get(nome) : intestazioni[nome];
}

// Impronta dell'indirizzo email, per segnare chi ha caricato il file senza scrivere l'email
// nelle proprietà (che hanno un limite di 124 byte).
function impronta(email) {
  return crypto.createHash('sha256').update(email).digest('base64url').slice(0, 32);
}

// Crea una sessione di caricamento: il browser invierà il file direttamente a Drive a quell'indirizzo.
// "origine" è l'indirizzo del sito: serve a Drive per accettare il caricamento dal browser.
async function creaSessioneCaricamento({ nome, dimensione, tipo, idFoto, idInvio, email, origine }) {
  const risposta = await chiedi({
    url: `${API_CARICAMENTO}?uploadType=resumable&supportsAllDrives=true&fields=id`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': tipo,
      'X-Upload-Content-Length': String(dimensione),
      Origin: origine,
    },
    data: {
      name: nome,
      parents: [variabile('FOLDER_DA_APPROVARE_ID')],
      appProperties: { idFoto: idFoto, idInvio: idInvio, chi: impronta(email) },
    },
  }, 'creazione della sessione di caricamento');
  const indirizzo = valoreIntestazione(risposta.headers, 'location');
  if (!indirizzo) {
    console.error('Drive: la sessione di caricamento non ha restituito un indirizzo');
    throw new ErroApi(500, 'errore_drive');
  }
  return indirizzo;
}

async function metadati(idFile) {
  const risposta = await chiedi({
    url: `${API}${encodeURIComponent(idFile)}?supportsAllDrives=true&fields=id,name,size,mimeType,parents,trashed,appProperties`,
  }, 'lettura dei dati del file');
  return risposta.data;
}

// Oggetto con slice(da, a).arrayBuffer(), come un File del browser, per far leggere
// a CaiExif solo le parti che servono del file su Drive.
function fileDrive(idFile, dimensione) {
  return {
    size: dimensione,
    slice(da, a) {
      const fine = Math.min(a, dimensione);
      return {
        async arrayBuffer() {
          if (fine <= da) return new ArrayBuffer(0);
          const risposta = await chiedi({
            url: `${API}${encodeURIComponent(idFile)}?alt=media&supportsAllDrives=true`,
            headers: { Range: `bytes=${da}-${fine - 1}` },
            responseType: 'arraybuffer',
          }, 'lettura del file');
          const dati = risposta.data;
          return Buffer.isBuffer(dati) ? dati.buffer.slice(dati.byteOffset, dati.byteOffset + dati.length) : dati;
        },
      };
    },
  };
}

// Miniatura generata da Drive, letta con le credenziali dell'account di servizio (non è mai un indirizzo
// pubblico). "dimensione" è il lato lungo in pixel. Lancia ErroApi 404 'anteprima_non_disponibile' se Drive
// non ha (ancora) una miniatura per il file.
async function miniatura(idFile, dimensione) {
  const meta = await chiedi({
    url: `${API}${encodeURIComponent(idFile)}?supportsAllDrives=true&fields=thumbnailLink`,
  }, 'lettura della miniatura');
  const indirizzo = meta.data && meta.data.thumbnailLink;
  let url;
  try {
    url = new URL(indirizzo);
  } catch (errore) {
    throw new ErroApi(404, 'anteprima_non_disponibile');
  }
  if (url.protocol !== 'https:' || !/(^|\.)(googleusercontent\.com|google\.com|googleapis\.com)$/.test(url.hostname)) {
    throw new ErroApi(404, 'anteprima_non_disponibile');
  }
  const base = indirizzo.replace(/=s\d+[^=]*$/, '');
  let risposta;
  try {
    risposta = await chiedi({ url: `${base}=s${dimensione}`, responseType: 'arraybuffer' }, 'lettura della miniatura');
  } catch (errore) {
    if (errore instanceof ErroApi && errore.codice === 'drive_non_trovato') throw new ErroApi(404, 'anteprima_non_disponibile');
    throw errore;
  }
  return {
    dati: Buffer.from(risposta.data),
    tipo: valoreIntestazione(risposta.headers, 'content-type') || 'image/jpeg',
  };
}

// Sposta un file da una cartella a un'altra. Ripetibile: se è già nella cartella di arrivo non fa nulla.
async function sposta(idFile, cartellaArrivo) {
  const meta = await metadati(idFile);
  const genitori = meta.parents || [];
  if (genitori.length === 1 && genitori[0] === cartellaArrivo) return false;
  const daTogliere = genitori.filter((g) => g !== cartellaArrivo);
  await chiedi({
    url: `${API}${encodeURIComponent(idFile)}?supportsAllDrives=true&addParents=${encodeURIComponent(cartellaArrivo)}` +
      (daTogliere.length ? `&removeParents=${encodeURIComponent(daTogliere.join(','))}` : '') + '&fields=id',
    method: 'PATCH',
    data: {},
  }, 'spostamento del file');
  return true;
}

// Elimina DEFINITIVAMENTE un file (non lo mette nel cestino). Per sicurezza elimina solo file che stanno in una delle
// cartelle indicate (le tre cartelle delle foto): un id sbagliato nel foglio non può cancellare altro.
// Restituisce 'eliminato', oppure 'assente' se non c'era già più (ripetibile).
// In un Drive condiviso Google permette di eliminare per sempre solo a chi è «Gestore» del drive (non basta «Gestore dei
// contenuti»): se manca il permesso, il file va nel cestino del Drive (si può fare anche con «Gestore dei contenuti» e si
// svuota da solo dopo 30 giorni) e si restituisce 'cestino', così chi usa il sito sa che non è sparito del tutto.
async function elimina(idFile, cartelleAmmesse) {
  let meta;
  try {
    meta = await metadati(idFile);
  } catch (errore) {
    if (errore instanceof ErroApi && errore.codice === 'drive_non_trovato') return 'assente';
    throw errore;
  }
  if (!(meta.parents || []).some((g) => cartelleAmmesse.includes(g))) throw new ErroApi(409, 'file_non_valido');
  const url = `${API}${encodeURIComponent(idFile)}?supportsAllDrives=true`;
  try {
    await chiedi({ url, method: 'DELETE' }, 'eliminazione del file');
    return 'eliminato';
  } catch (errore) {
    if (errore instanceof ErroApi && errore.codice === 'drive_non_trovato') return 'assente';
    if (!(errore instanceof ErroApi) || errore.codice !== 'drive_non_consentito') throw errore;
  }
  if (meta.trashed) return 'cestino';
  await chiedi({ url: url + '&fields=id', method: 'PATCH', data: { trashed: true } }, 'spostamento del file nel cestino');
  return 'cestino';
}

// ---- File di dati dell'applicazione (JSON) nel Drive condiviso ----
// Servono ai dati sincronizzati (settori e percorsi del CAI). Sono file creati dall'account di servizio
// (visibili con lo scope drive.file), nella radice del Drive condiviso, riconosciuti dalla proprietà "dati".

async function trovaFileDati(nome) {
  const q = `appProperties has { key='dati' and value='${nome.replace(/[^A-Za-z0-9_-]/g, '')}' } and trashed=false`;
  const risposta = await chiedi({
    url: `${API.replace(/\/$/, '')}?corpora=drive&driveId=${encodeURIComponent(variabile('DRIVE_ID'))}&includeItemsFromAllDrives=true&supportsAllDrives=true` +
      `&q=${encodeURIComponent(q)}&fields=files(id)`,
  }, 'ricerca di un file di dati');
  const trovati = (risposta.data && risposta.data.files) || [];
  return trovati.length ? trovati[0].id : null;
}

// Contenuto del file di dati, oppure null se non esiste ancora.
async function leggiDato(nome) {
  const id = await trovaFileDati(nome);
  if (!id) return null;
  const risposta = await chiedi({
    url: `${API}${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
    responseType: 'text',
  }, 'lettura di un file di dati');
  try {
    return JSON.parse(risposta.data);
  } catch (errore) {
    console.error(`Drive: il file di dati "${nome}" non è un JSON valido`);
    throw new ErroApi(500, 'dati_non_validi', `Il file di dati "${nome}" non è leggibile`);
  }
}

// Scrive (crea o sostituisce) il file di dati. Un file solo per nome: se esiste, si aggiorna il contenuto.
async function scriviDato(nome, oggetto) {
  const contenuto = JSON.stringify(oggetto);
  const id = await trovaFileDati(nome);
  if (id) {
    await chiedi({
      url: `${API_CARICAMENTO}/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=id`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      data: contenuto,
    }, 'aggiornamento di un file di dati');
    return;
  }
  const confine = 'fotosentieri' + crypto.randomBytes(8).toString('hex');
  const metadati = { name: `dati-${nome}.json`, parents: [variabile('DRIVE_ID')], mimeType: 'application/json', appProperties: { dati: nome } };
  const corpo = `--${confine}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadati)}\r\n` +
    `--${confine}\r\nContent-Type: application/json\r\n\r\n${contenuto}\r\n--${confine}--`;
  await chiedi({
    url: `${API_CARICAMENTO}?uploadType=multipart&supportsAllDrives=true&fields=id`,
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${confine}` },
    data: corpo,
  }, 'creazione di un file di dati');
}

module.exports = { impronta, creaSessioneCaricamento, metadati, fileDrive, miniatura, sposta, elimina, leggiDato, scriviDato, traduciErrore };
