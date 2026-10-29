// GET /api/admin/tracciati?settore=<id>   (admin e super_admin)
// I tracciati dei sentieri di un settore attivo, per disegnarli sulla mappa: { settore, tracciati: { "<idPercorso>": [linea, ...] } }
// dove ogni linea è una lista di punti [lon, lat]. Numero, nome e comuni dei sentieri si leggono da /api/sentieri.
// Un settore alla volta, così le risposte restano piccole (il piano Hobby di Vercel limita la dimensione delle risposte).
// Legge i dati già sincronizzati (file su Drive), mai il server del CAI.
const { RUOLI_ADMIN, protetto } = require('../../_lib/auth');
const { ErroApi } = require('../../_lib/sheets');
const { leggiDato } = require('../../_lib/drive');
const { DATI } = require('../../_lib/sincronizzazione');
const { menuSentieri } = require('../../_lib/sentieri');

const DURATA_COPIA_MS = 5 * 60 * 1000;
let copia = { quando: 0, dati: null }; // i tracciati cambiano al massimo una volta per notte: si tengono in memoria per qualche minuto

async function tracciatiSalvati() {
  if (copia.dati && Date.now() - copia.quando < DURATA_COPIA_MS) return copia.dati;
  const dati = (await leggiDato(DATI.geometrie)) || {};
  copia = { quando: Date.now(), dati };
  return dati;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta) => {
    const testo = new URL(richiesta.url, 'http://localhost').searchParams.get('settore');
    if (!/^\d{1,9}$/.test(testo || '')) throw new ErroApi(400, 'richiesta_non_valida', 'settore non valido');
    const id = Number(testo);
    const menu = await menuSentieri();
    if (!menu.settori.some((s) => s.id === id)) throw new ErroApi(404, 'settore_non_trovato');
    const geometrie = await tracciatiSalvati();
    const tracciati = {};
    menu.percorsi.filter((p) => p.settori.includes(id)).forEach((p) => {
      if (geometrie[p.id] && Array.isArray(geometrie[p.id].c)) tracciati[p.id] = geometrie[p.id].c;
    });
    risposta.setHeader('Cache-Control', 'private, no-store');
    risposta.status(200).json({ settore: id, tracciati });
  })(req, res);
};
