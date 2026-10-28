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

module.exports = { impronta, creaSessioneCaricamento, metadati, fileDrive, traduciErrore };
