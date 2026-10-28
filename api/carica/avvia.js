// POST /api/carica/avvia   (solo volontari)
// Corpo: { idInvio, foto: [{ idFoto, nome, dimensione, tipo }] }   (al massimo 50 foto per richiesta)
// Risposta: { sessioni: [{ idFoto, indirizzo }] }
// Per ogni foto il server crea su Drive una sessione di caricamento nella cartella "Da approvare":
// il browser invia poi il file originale direttamente a quell'indirizzo.
const { protetto } = require('../_lib/auth');
const { ErroApi } = require('../_lib/sheets');
const drive = require('../_lib/drive');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FOTO = 50;
const MAX_BYTE = 200 * 1024 * 1024;
const ESTENSIONI_PER_TIPO = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/heic': ['heic', 'heif'],
  'image/heif': ['heic', 'heif'],
};

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

// Drive accetta il caricamento dal browser solo se la sessione è creata con l'indirizzo del sito.
function origineDelSito(req) {
  const origine = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origine && host && (origine === 'https://' + host || (/^http:\/\/localhost(:\d+)?$/.test(origine) && origine === 'http://' + host))) {
    return origine;
  }
  throw new ErroApi(400, 'origine_non_valida');
}

function nomeDrive(idFoto, nome) {
  const base = String(nome).split(/[\\/]/).pop().replace(/[^\p{L}\p{N}._ ()-]/gu, '_').slice(-120);
  return `${idFoto}_${base}`;
}

function controllaFoto(f) {
  if (!f || typeof f !== 'object') throw richiestaNonValida('foto non valida');
  if (typeof f.idFoto !== 'string' || !UUID.test(f.idFoto)) throw richiestaNonValida('idFoto non valido');
  if (typeof f.nome !== 'string' || f.nome.length === 0 || f.nome.length > 300) throw richiestaNonValida('nome non valido');
  if (!Number.isInteger(f.dimensione) || f.dimensione < 1 || f.dimensione > MAX_BYTE) throw new ErroApi(400, 'file_troppo_grande');
  const estensioni = ESTENSIONI_PER_TIPO[f.tipo];
  const estensione = (/\.([A-Za-z0-9]+)$/.exec(f.nome) || [])[1];
  if (!estensioni || !estensione || !estensioni.includes(estensione.toLowerCase())) throw new ErroApi(400, 'formato_non_ammesso');
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
    if (!Array.isArray(corpo.foto) || corpo.foto.length < 1 || corpo.foto.length > MAX_FOTO) throw new ErroApi(400, 'troppe_foto');
    corpo.foto.forEach(controllaFoto);
    const idUnici = new Set(corpo.foto.map((f) => f.idFoto));
    if (idUnici.size !== corpo.foto.length) throw richiestaNonValida('idFoto ripetuti');
    const origine = origineDelSito(richiesta);

    const sessioni = await conLimite(corpo.foto, 5, async (f) => ({
      idFoto: f.idFoto,
      indirizzo: await drive.creaSessioneCaricamento({
        nome: nomeDrive(f.idFoto, f.nome),
        dimensione: f.dimensione,
        tipo: f.tipo,
        idFoto: f.idFoto,
        idInvio: corpo.idInvio,
        email: utente.email,
        origine: origine,
      }),
    }));
    risposta.status(200).json({ sessioni: sessioni });
  })(req, res);
};
