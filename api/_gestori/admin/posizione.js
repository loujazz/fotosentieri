// POST /api/admin/posizione   (admin e super_admin)
// Corpo: { idFoto, lat, lon }. Un amministratore indica la posizione di una foto che non ce l'ha (o di una già indicata da
// un amministratore): si scrivono solo latitudine, longitudine e fonte_posizione = "correzione_admin".
// Una posizione letta dal file (EXIF) non si cambia. Risposta: { idFoto, lat, lon, fontePosizione }.
const { RUOLI_ADMIN, protetto } = require('../../_lib/auth');
const { ErroApi, leggiScheda, aggiornaCellePerId } = require('../../_lib/sheets');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FONTE = 'correzione_admin';
// Rete di sicurezza contro i clic sbagliati: la posizione deve stare in Italia (con un po' di margine).
const ZONA = { sud: 35.4, nord: 47.2, ovest: 6.5, est: 18.8 };

function numero(valore) {
  if (valore === '' || valore === undefined || valore === null) return null;
  const n = Number(String(valore).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function leggiCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (errore) {
    throw new ErroApi(400, 'richiesta_non_valida', 'corpo non valido');
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta) => {
    const corpo = leggiCorpo(richiesta);
    if (typeof corpo.idFoto !== 'string' || !UUID.test(corpo.idFoto)) throw new ErroApi(400, 'richiesta_non_valida', 'idFoto non valido');
    if (typeof corpo.lat !== 'number' || typeof corpo.lon !== 'number' || !Number.isFinite(corpo.lat) || !Number.isFinite(corpo.lon)) {
      throw new ErroApi(400, 'richiesta_non_valida', 'posizione non valida');
    }
    if (Math.abs(corpo.lat) > 90 || Math.abs(corpo.lon) > 180) throw new ErroApi(400, 'richiesta_non_valida', 'posizione fuori dai limiti');
    if (corpo.lat < ZONA.sud || corpo.lat > ZONA.nord || corpo.lon < ZONA.ovest || corpo.lon > ZONA.est) {
      throw new ErroApi(400, 'posizione_fuori_zona', 'la posizione non è in Italia');
    }
    const lat = Math.round(corpo.lat * 1e6) / 1e6;
    const lon = Math.round(corpo.lon * 1e6) / 1e6;

    const foto = await leggiScheda('foto', { conRiga: true });
    const riga = foto.find((f) => f.id_foto === corpo.idFoto);
    if (!riga) throw new ErroApi(404, 'foto_non_trovata');
    const haPosizione = numero(riga.latitudine) !== null && numero(riga.longitudine) !== null;
    if (haPosizione && riga.fonte_posizione !== FONTE) throw new ErroApi(409, 'posizione_gia_presente'); // quella del file non si tocca

    const scomparse = await aggiornaCellePerId('foto', 'id_foto', [{ id: corpo.idFoto, valori: { latitudine: lat, longitudine: lon, fonte_posizione: FONTE } }]);
    if (scomparse.length) throw new ErroApi(404, 'foto_non_trovata');
    risposta.status(200).json({ idFoto: corpo.idFoto, lat, lon, fontePosizione: FONTE });
  })(req, res);
};
