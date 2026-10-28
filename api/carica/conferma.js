// POST /api/carica/conferma   (solo volontari)
// Corpo: { idInvio, dataSopralluogo?, totaleFoto, foto: [{ idFoto, idFileDrive }] }   (al massimo 100 foto)
// Dopo il caricamento su Drive, il server controlla ogni file (cartella, proprietario, tipo), rilegge
// posizione e data dal file stesso (non si fida del browser) e aggiunge le righe nelle schede
// "invii" e "foto". Ripetibile senza duplicati. Risposta: { registrate: [idFoto], errori: [{ idFoto, errore }] }
const { protetto } = require('../_lib/auth');
const { ErroApi, variabile, leggiScheda, aggiungiRighe } = require('../_lib/sheets');
const drive = require('../_lib/drive');
const CaiExif = require('../../public/exif.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FOTO = 100;
const TIPI_AMMESSI = ['image/jpeg', 'image/heic', 'image/heif'];

function richiestaNonValida(motivo) {
  return new ErroApi(400, 'richiesta_non_valida', motivo);
}

function leggiCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (errore) {
    throw richiestaNonValida('corpo non valido');
  }
}

function dataValida(testo) {
  if (!DATA.test(testo)) return false;
  const d = new Date(testo + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === testo;
}

// Controlla un file su Drive e ne legge i dati dello scatto. Lancia ErroApi con un codice se non va bene.
async function verificaFile(foto, idInvio, email) {
  let meta;
  try {
    meta = await drive.metadati(foto.idFileDrive);
  } catch (errore) {
    if (errore instanceof ErroApi && errore.codice === 'drive_non_trovato') throw new ErroApi(404, 'file_non_trovato');
    throw errore;
  }
  const proprieta = meta.appProperties || {};
  const cartella = variabile('FOLDER_DA_APPROVARE_ID');
  if (meta.trashed || !(meta.parents || []).includes(cartella) ||
      proprieta.idFoto !== foto.idFoto || proprieta.idInvio !== idInvio || proprieta.chi !== drive.impronta(email) ||
      !TIPI_AMMESSI.includes(meta.mimeType)) {
    throw new ErroApi(400, 'file_non_valido');
  }
  const dimensione = Number(meta.size);
  if (!Number.isFinite(dimensione) || dimensione < 1) throw new ErroApi(400, 'file_non_valido');
  const esito = await CaiExif.leggi(drive.fileDrive(foto.idFileDrive, dimensione));
  const prefisso = foto.idFoto + '_';
  return {
    nomeFile: meta.name && meta.name.startsWith(prefisso) ? meta.name.slice(prefisso.length) : meta.name,
    esito: esito,
  };
}

async function conLimite(elementi, limite, azione) {
  const risultati = new Array(elementi.length);
  let prossimo = 0;
  async function lavora() {
    while (prossimo < elementi.length) {
      const i = prossimo++;
      risultati[i] = await azione(elementi[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, elementi.length) }, lavora));
  return risultati;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(['volontario'], async (richiesta, risposta, utente) => {
    const corpo = leggiCorpo(richiesta);
    if (typeof corpo.idInvio !== 'string' || !UUID.test(corpo.idInvio)) throw richiestaNonValida('idInvio non valido');
    if (!Number.isInteger(corpo.totaleFoto) || corpo.totaleFoto < 1 || corpo.totaleFoto > 5000) throw richiestaNonValida('totaleFoto non valido');
    if (corpo.dataSopralluogo !== undefined && corpo.dataSopralluogo !== '' &&
        (typeof corpo.dataSopralluogo !== 'string' || !dataValida(corpo.dataSopralluogo))) {
      throw richiestaNonValida('dataSopralluogo non valida');
    }
    if (!Array.isArray(corpo.foto) || corpo.foto.length < 1 || corpo.foto.length > MAX_FOTO) throw new ErroApi(400, 'troppe_foto');
    corpo.foto.forEach((f) => {
      if (!f || typeof f.idFoto !== 'string' || !UUID.test(f.idFoto) || typeof f.idFileDrive !== 'string' || !ID_DRIVE.test(f.idFileDrive)) {
        throw richiestaNonValida('foto non valida');
      }
    });
    if (new Set(corpo.foto.map((f) => f.idFoto)).size !== corpo.foto.length) throw richiestaNonValida('idFoto ripetuti');

    // 1. Controllo dei file su Drive e lettura dei dati dello scatto, con errori per singola foto.
    const errori = [];
    const verificate = [];
    await conLimite(corpo.foto, 4, async (f) => {
      try {
        verificate.push({ foto: f, ...(await verificaFile(f, corpo.idInvio, utente.email)) });
      } catch (errore) {
        if (!(errore instanceof ErroApi)) throw errore;
        errori.push({ idFoto: f.idFoto, errore: errore.codice });
      }
    });

    // 2. Righe nel foglio, senza duplicare quelle già scritte da un tentativo precedente.
    const [invii, fotoEsistenti] = await Promise.all([leggiScheda('invii'), leggiScheda('foto')]);
    const invio = invii.find((r) => r.id_invio === corpo.idInvio);
    if (invio && (invio.email_volontario || '').toLowerCase() !== utente.email) throw new ErroApi(403, 'invio_non_valido');
    const giaScritte = new Set(fotoEsistenti.map((r) => r.id_foto));
    const nuove = verificate.filter((v) => !giaScritte.has(v.foto.idFoto));

    if (!invio && verificate.length > 0) {
      const date = verificate.map((v) => (v.esito.dataScatto || '').slice(0, 10)).filter(dataValida).sort();
      const dataSopralluogo = corpo.dataSopralluogo || date[0] || new Date().toISOString().slice(0, 10);
      await aggiungiRighe('invii', [{
        id_invio: corpo.idInvio,
        email_volontario: utente.email,
        nome_volontario: utente.nome,
        data_sopralluogo: dataSopralluogo,
        settore: '',
        sentiero: '',
        data_invio: new Date().toISOString(),
        num_foto: corpo.totaleFoto,
      }]);
    }
    await aggiungiRighe('foto', nuove.map((v) => {
      const posizione = v.esito.lat !== null;
      return {
        id_foto: v.foto.idFoto,
        id_invio: corpo.idInvio,
        id_file_drive: v.foto.idFileDrive,
        nome_file: v.nomeFile,
        latitudine: posizione ? v.esito.lat : '',
        longitudine: posizione ? v.esito.lon : '',
        fonte_posizione: posizione ? 'EXIF' : '',
        data_scatto: v.esito.dataScatto || '',
        etichetta: '',
        nota: '',
        stato: 'in_attesa',
        rivista_da: '',
        rivista_il: '',
        motivo_rifiuto: '',
      };
    }));

    risposta.status(200).json({ registrate: verificate.map((v) => v.foto.idFoto), errori: errori });
  })(req, res);
};
