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
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        // Solo i file creati dall'account di servizio (le foto caricate dal sito), non tutto il Drive.
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
  }
  return auth.getClient();
}

// Restituisce le righe di una scheda come oggetti { intestazione: valore }.
// Le colonne si trovano per nome dell'intestazione (riga 1), non per posizione.
// Con { conRiga: true } ogni oggetto ha anche _riga, il numero di riga nel foglio (la riga 1 è l'intestazione).
// I valori si leggono "non formattati": un numero come 44,4949 (formato italiano) arriva come 44.4949.
async function leggiScheda(nomeScheda, opzioni) {
  const idFoglio = variabile('SHEET_ID');
  const intervallo = encodeURIComponent(`${nomeScheda}!A:Z`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(idFoglio)}/values/${intervallo}?valueRenderOption=UNFORMATTED_VALUE`;
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
  const conRiga = Boolean(opzioni && opzioni.conRiga);
  return righe.slice(1).map((riga, indice) => {
    const oggetto = {};
    intestazioni.forEach((nome, i) => {
      if (nome) oggetto[nome] = riga[i] === undefined ? '' : String(riga[i]).trim();
    });
    if (conRiga) oggetto._riga = indice + 2;
    return oggetto;
  });
}

// Aggiunge righe in fondo a una scheda (mai riscrittura del contenuto esistente).
// Ogni riga è un oggetto { intestazione: valore }; le colonne si trovano per nome nella riga 1.
// Valori scritti "così come sono" (RAW): nessuna formula può nascere da un nome di file o da una nota.
async function aggiungiRighe(nomeScheda, oggetti) {
  if (!oggetti.length) return;
  const idFoglio = encodeURIComponent(variabile('SHEET_ID'));
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${idFoglio}/values/`;
  try {
    const client = await clientGoogle();
    const testata = await client.request({ url: base + encodeURIComponent(`${nomeScheda}!1:1`) });
    const intestazioni = ((testata.data && testata.data.values && testata.data.values[0]) || [])
      .map((h) => String(h).trim().toLowerCase());
    Object.keys(oggetti[0]).forEach((chiave) => {
      if (!intestazioni.includes(chiave)) {
        throw new ErroApi(500, 'errore_foglio', `Nella scheda "${nomeScheda}" manca la colonna "${chiave}"`);
      }
    });
    // Una cella accetta solo testo o numeri: qualsiasi altra cosa (oggetti, elenchi, vero/falso) si scrive come testo.
    const cella = (x) => (x === undefined || x === null ? '' : (typeof x === 'string' || typeof x === 'number' ? x : (typeof x === 'object' ? JSON.stringify(x) : String(x))));
    const valori = oggetti.map((o) => intestazioni.map((h) => cella(o[h])));
    await client.request({
      url: `${base}${encodeURIComponent(`${nomeScheda}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      method: 'POST',
      data: { values: valori },
    });
  } catch (errore) {
    if (errore instanceof ErroApi) throw errore;
    const stato = errore.response && errore.response.status;
    const dettaglio = errore.response && errore.response.data && errore.response.data.error && errore.response.data.error.message;
    console.error(`Scrittura nella scheda "${nomeScheda}" non riuscita (HTTP ${stato || '?'}):`, dettaglio || errore.message);
    throw new ErroApi(500, 'errore_foglio', `Impossibile scrivere nella scheda "${nomeScheda}"`);
  }
}

// Crea la scheda (linguetta) con la riga delle intestazioni se non esiste ancora. Restituisce true se l'ha creata.
async function assicuraScheda(nomeScheda, intestazioni) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(variabile('SHEET_ID'))}`;
  try {
    const client = await clientGoogle();
    const meta = await client.request({ url: `${base}?fields=sheets.properties.title` });
    const esiste = ((meta.data && meta.data.sheets) || []).some((f) => f.properties && f.properties.title === nomeScheda);
    if (esiste) return false;
    await client.request({ url: `${base}:batchUpdate`, method: 'POST', data: { requests: [{ addSheet: { properties: { title: nomeScheda } } }] } });
    await client.request({
      url: `${base}/values/${encodeURIComponent(`${nomeScheda}!A1`)}?valueInputOption=RAW`,
      method: 'PUT',
      data: { values: [intestazioni] },
    });
    return true;
  } catch (errore) {
    if (errore instanceof ErroApi) throw errore;
    const stato = errore.response && errore.response.status;
    console.error(`Creazione della scheda "${nomeScheda}" non riuscita (HTTP ${stato || '?'}):`, errore.message);
    throw new ErroApi(500, 'errore_foglio', `Impossibile creare la scheda "${nomeScheda}"`);
  }
}

// Aggiunge in fondo alla riga delle intestazioni una colonna che manca (per esempio «ultimo_accesso» nella scheda
// "utenti"), senza toccare le altre. Restituisce true se l'ha aggiunta, false se c'era già.
async function assicuraColonna(nomeScheda, colonna) {
  const idFoglio = encodeURIComponent(variabile('SHEET_ID'));
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${idFoglio}/values`;
  try {
    const client = await clientGoogle();
    const testata = await client.request({ url: `${base}/${encodeURIComponent(`${nomeScheda}!1:1`)}` });
    const intestazioni = ((testata.data && testata.data.values && testata.data.values[0]) || []).map((h) => String(h).trim().toLowerCase());
    if (intestazioni.includes(colonna)) return false;
    await client.request({
      url: `${base}/${encodeURIComponent(`${nomeScheda}!${letteraColonna(intestazioni.length)}1`)}?valueInputOption=RAW`,
      method: 'PUT',
      data: { values: [[colonna]] },
    });
    return true;
  } catch (errore) {
    if (errore instanceof ErroApi) throw errore;
    const stato = errore.response && errore.response.status;
    console.error(`Aggiunta della colonna "${colonna}" alla scheda "${nomeScheda}" non riuscita (HTTP ${stato || '?'}):`, errore.message);
    throw new ErroApi(500, 'errore_foglio', `Impossibile aggiungere la colonna "${colonna}"`);
  }
}

// Cancella dalla scheda le righe il cui valore nella colonna indicata è tra "valori" (per esempio id_foto). Le righe si
// cercano di nuovo subito prima di cancellare e si tolgono in una sola richiesta, dal basso verso l'alto, così i numeri
// di riga non si spostano. L'intestazione (riga 1) non si tocca mai. Restituisce quante righe ha cancellato.
async function eliminaRighe(nomeScheda, colonna, valori) {
  const richiesti = new Set(valori.map(String));
  if (!richiesti.size) return 0;
  const righe = (await leggiScheda(nomeScheda, { conRiga: true })).filter((r) => richiesti.has(String(r[colonna])));
  if (!righe.length) return 0;
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(variabile('SHEET_ID'))}`;
  try {
    const client = await clientGoogle();
    const meta = await client.request({ url: `${base}?fields=sheets.properties(sheetId,title)` });
    const foglio = ((meta.data && meta.data.sheets) || []).find((f) => f.properties && f.properties.title === nomeScheda);
    if (!foglio) throw new ErroApi(500, 'errore_foglio', `Scheda "${nomeScheda}" non trovata`);
    const richieste = righe.map((r) => r._riga).filter((n) => n >= 2).sort((a, b) => b - a).map((n) => ({
      deleteDimension: { range: { sheetId: foglio.properties.sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } },
    }));
    await client.request({ url: `${base}:batchUpdate`, method: 'POST', data: { requests: richieste } });
    return richieste.length;
  } catch (errore) {
    if (errore instanceof ErroApi) throw errore;
    const stato = errore.response && errore.response.status;
    console.error(`Eliminazione di righe dalla scheda "${nomeScheda}" non riuscita (HTTP ${stato || '?'}):`, errore.message);
    throw new ErroApi(500, 'errore_foglio', `Impossibile eliminare righe dalla scheda "${nomeScheda}"`);
  }
}

// Come aggiornaCelle, ma le righe si trovano dall'identificativo (per esempio id_foto) al momento di scrivere, non da un
// numero di riga letto prima: se nel frattempo una riga è stata cancellata (o le righe si sono spostate), non si scrive
// mai nella riga sbagliata. modifiche: [{ id, valori }]. Restituisce gli id che non ci sono più nella scheda.
async function aggiornaCellePerId(nomeScheda, colonnaId, modifiche) {
  if (!modifiche.length) return [];
  const righe = new Map((await leggiScheda(nomeScheda, { conRiga: true })).map((r) => [String(r[colonnaId]), r._riga]));
  const trovate = modifiche.filter((m) => righe.has(String(m.id)));
  await aggiornaCelle(nomeScheda, trovate.map((m) => ({ riga: righe.get(String(m.id)), valori: m.valori })));
  return modifiche.filter((m) => !righe.has(String(m.id))).map((m) => m.id);
}

function letteraColonna(indice) {
  let n = indice + 1;
  let lettera = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    lettera = String.fromCharCode(65 + resto) + lettera;
    n = Math.floor((n - 1) / 26);
  }
  return lettera;
}

// Cambia solo le celle indicate, in righe già esistenti (mai riscrittura della scheda).
// modifiche: [{ riga, valori: { colonna: valore } }], con "riga" come numero di riga del foglio.
async function aggiornaCelle(nomeScheda, modifiche) {
  if (!modifiche.length) return;
  const idFoglio = encodeURIComponent(variabile('SHEET_ID'));
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${idFoglio}/values`;
  try {
    const client = await clientGoogle();
    const testata = await client.request({ url: `${base}/${encodeURIComponent(`${nomeScheda}!1:1`)}` });
    const intestazioni = ((testata.data && testata.data.values && testata.data.values[0]) || [])
      .map((h) => String(h).trim().toLowerCase());
    const dati = [];
    modifiche.forEach((m) => {
      if (!Number.isInteger(m.riga) || m.riga < 2) throw new ErroApi(500, 'errore_foglio', 'Numero di riga non valido');
      Object.keys(m.valori).forEach((colonna) => {
        const i = intestazioni.indexOf(colonna);
        if (i === -1) throw new ErroApi(500, 'errore_foglio', `Nella scheda "${nomeScheda}" manca la colonna "${colonna}"`);
        dati.push({ range: `${nomeScheda}!${letteraColonna(i)}${m.riga}`, values: [[m.valori[colonna]]] });
      });
    });
    await client.request({ url: `${base}:batchUpdate`, method: 'POST', data: { valueInputOption: 'RAW', data: dati } });
  } catch (errore) {
    if (errore instanceof ErroApi) throw errore;
    const stato = errore.response && errore.response.status;
    console.error(`Aggiornamento della scheda "${nomeScheda}" non riuscito (HTTP ${stato || '?'}):`, errore.message);
    throw new ErroApi(500, 'errore_foglio', `Impossibile aggiornare la scheda "${nomeScheda}"`);
  }
}

module.exports = { ErroApi, variabile, leggiScheda, aggiungiRighe, aggiornaCelle, aggiornaCellePerId, eliminaRighe, assicuraScheda, assicuraColonna, clientGoogle };
