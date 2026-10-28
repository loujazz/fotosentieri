// Accesso al foglio Google con l'account di servizio (mai con le credenziali dell'utente).
const { GoogleAuth } = require('google-auth-library');

class ErroApi extends Error {
  constructor(stato, codice, messaggio) {
    super(messaggio || codice);
    this.stato = stato;
    this.codice = codice;
  }
}

function variabile(nome) {
  const valore = process.env[nome];
  if (!valore || !valore.trim()) {
    throw new ErroApi(500, 'configurazione', `Variabile d'ambiente mancante: ${nome}`);
  }
  return valore.trim();
}

// Legge il JSON dell'account di servizio da un'unica variabile e sistema gli a-capo
// della private_key, che a seconda di come è stato incollato il valore possono arrivare:
//  - come "\n" scritto nel JSON (caso normale: JSON.parse li trasforma in a-capo veri);
//  - come "\\n" (doppio escape): vanno trasformati in a-capo veri;
//  - come a-capo veri dentro la stringa (JSON non valido): vanno prima protetti.
function leggiCredenziali() {
  const grezzo = variabile('GOOGLE_SERVICE_ACCOUNT_JSON');
  let credenziali;
  try {
    credenziali = JSON.parse(grezzo);
  } catch (primoErrore) {
    const riparato = grezzo.replace(
      /("private_key"\s*:\s*")([\s\S]*?)(")/,
      (_, apertura, chiave, chiusura) =>
        apertura + chiave.replace(/\r?\n/g, '\\n') + chiusura
    );
    try {
      credenziali = JSON.parse(riparato);
    } catch (secondoErrore) {
      throw new ErroApi(500, 'configurazione', 'GOOGLE_SERVICE_ACCOUNT_JSON non è un JSON valido');
    }
  }
  if (!credenziali.client_email || !credenziali.private_key) {
    throw new ErroApi(500, 'configurazione', 'GOOGLE_SERVICE_ACCOUNT_JSON non contiene client_email e private_key');
  }
  credenziali.private_key = credenziali.private_key.replace(/\\n/g, '\n');
  if (!credenziali.private_key.includes('BEGIN PRIVATE KEY')) {
    throw new ErroApi(500, 'configurazione', 'private_key del JSON non è nel formato atteso');
  }
  return credenziali;
}

// Solo per i log di diagnostica: email dell'account di servizio (non è un segreto).
function emailAccountDiServizio() {
  try {
    return leggiCredenziali().client_email;
  } catch (errore) {
    return '(non leggibile)';
  }
}

// Mostra solo lunghezza, inizio e fine di un ID, mai il valore intero.
function descriviId(id) {
  return `${id.length} caratteri, ${id.slice(0, 4)}…${id.slice(-4)}`;
}

let auth;
function clientGoogle() {
  if (!auth) {
    auth = new GoogleAuth({
      credentials: leggiCredenziali(),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return auth.getClient();
}

// Restituisce le righe di una scheda come oggetti { intestazione: valore }.
// Le colonne si trovano per nome dell'intestazione (riga 1), non per posizione.
async function leggiScheda(nomeScheda) {
  const idFoglio = variabile('SHEET_ID');
  const intervallo = encodeURIComponent(`${nomeScheda}!A:Z`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(idFoglio)}/values/${intervallo}`;
  let risposta;
  try {
    const client = await clientGoogle();
    risposta = await client.request({ url });
  } catch (errore) {
    if (errore instanceof ErroApi) throw errore;
    const stato = errore.response && errore.response.status;
    const dettaglio = errore.response && errore.response.data && errore.response.data.error;
    console.error(`Lettura della scheda "${nomeScheda}" non riuscita (HTTP ${stato || '?'}):`, errore.message);
    console.error('Diagnostica foglio:', JSON.stringify({
      motivo: dettaglio && (dettaglio.status || dettaglio.message),
      accountDiServizio: emailAccountDiServizio(),
      idFoglio: descriviId(idFoglio),
    }));
    throw new ErroApi(500, 'errore_foglio', `Impossibile leggere la scheda "${nomeScheda}"`);
  }
  const righe = (risposta.data && risposta.data.values) || [];
  if (righe.length === 0) return [];
  const intestazioni = righe[0].map((h) => String(h).trim().toLowerCase());
  return righe.slice(1).map((riga) => {
    const oggetto = {};
    intestazioni.forEach((nome, i) => {
      if (nome) oggetto[nome] = riga[i] === undefined ? '' : String(riga[i]).trim();
    });
    return oggetto;
  });
}

module.exports = { ErroApi, variabile, leggiScheda };
