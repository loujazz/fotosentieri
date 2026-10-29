// Settori del CAI   (admin e super_admin)
//   GET  /api/admin/settori -> { settori: [{ id, codice, nome, attivo, percorsi }], aggiornato }
//   POST /api/admin/settori { id, nome?, attivo? } -> stessa risposta dopo la modifica
// I settori arrivano dalla sincronizzazione con OSM2CAI nella scheda "settori" del foglio (solo un codice, per
// esempio HBOE8). Gli admin danno un nome comprensibile e scelgono quali settori compaiono ai volontari.
// La sincronizzazione non cambia mai nome e attivo dei settori già presenti.
const { RUOLI_ADMIN, protetto } = require('../_lib/auth');
const { ErroApi, leggiScheda, aggiornaCelle } = require('../_lib/sheets');
const { leggiDato } = require('../_lib/drive');
const { DATI } = require('../_lib/sincronizzazione');

const MAX_NOME = 60;

function siAttivo(valore) {
  return String(valore || '').trim().toUpperCase().replace('Ì', 'I') === 'SI';
}

function leggiCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (errore) {
    throw new ErroApi(400, 'richiesta_non_valida', 'corpo non valido');
  }
}

async function righeDelFoglio() {
  try {
    return await leggiScheda('settori', { conRiga: true });
  } catch (errore) {
    if (errore instanceof ErroApi && errore.codice === 'errore_foglio') return []; // la scheda nasce con la prima sincronizzazione
    throw errore;
  }
}

async function elenco() {
  const [righe, percorsi] = await Promise.all([righeDelFoglio(), leggiDato(DATI.percorsi)]);
  const conteggio = new Map();
  ((percorsi && percorsi.percorsi) || []).forEach((p) => (p.settori || []).forEach((id) => conteggio.set(String(id), (conteggio.get(String(id)) || 0) + 1)));
  const settori = righe
    .filter((r) => r.id_osm2cai !== '')
    .map((r) => ({ id: Number(r.id_osm2cai), codice: r.codice, nome: r.nome, attivo: siAttivo(r.attivo), percorsi: conteggio.get(String(r.id_osm2cai)) || 0, riga: r._riga }))
    .sort((a, b) => a.codice.localeCompare(b.codice, 'it', { numeric: true }));
  return { settori: settori.map(({ riga, ...resto }) => resto), aggiornato: (percorsi && percorsi.aggiornato) || null, _righe: settori };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta) => {
    if (richiesta.method === 'POST') {
      const corpo = leggiCorpo(richiesta);
      if (!Number.isInteger(corpo.id)) throw new ErroApi(400, 'richiesta_non_valida', 'id non valido');
      const attuale = await elenco();
      const settore = attuale._righe.find((s) => s.id === corpo.id);
      if (!settore) throw new ErroApi(404, 'settore_non_trovato');
      const valori = {};
      if (corpo.nome !== undefined) {
        if (typeof corpo.nome !== 'string') throw new ErroApi(400, 'richiesta_non_valida', 'nome non valido');
        const nome = corpo.nome.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (nome.length > MAX_NOME) throw new ErroApi(400, 'nome_troppo_lungo');
        valori.nome = nome;
      }
      if (corpo.attivo !== undefined) {
        if (typeof corpo.attivo !== 'boolean') throw new ErroApi(400, 'richiesta_non_valida', 'attivo non valido');
        valori.attivo = corpo.attivo ? 'SI' : 'NO';
      }
      if (Object.keys(valori).length === 0) throw new ErroApi(400, 'richiesta_non_valida', 'niente da modificare');
      await aggiornaCelle('settori', [{ riga: settore.riga, valori }]);
    }
    const { _righe, ...risultato } = await elenco();
    risposta.status(200).json(risultato);
  })(req, res);
};
