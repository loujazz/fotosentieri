// GET /api/admin/mappa   (admin e super_admin)
// Le foto approvate con la posizione, per la mappa, più il numero di quelle approvate senza posizione
// (che non si possono mettere sulla mappa). Le miniature si chiedono a parte con /api/admin/anteprima.
const { RUOLI_ADMIN, protetto } = require('../_lib/auth');
const { leggiScheda } = require('../_lib/sheets');

const LIMITE = 5000;

function numero(valore) {
  if (valore === '' || valore === undefined || valore === null) return null;
  const n = Number(String(valore).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta) => {
    const [foto, invii] = await Promise.all([leggiScheda('foto'), leggiScheda('invii')]);
    const perInvio = new Map(invii.map((i) => [i.id_invio, i]));
    const approvate = foto.filter((f) => f.stato === 'approvata');

    const conPosizione = [];
    let senzaPosizione = 0;
    approvate.forEach((f) => {
      const lat = numero(f.latitudine);
      const lon = numero(f.longitudine);
      if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        senzaPosizione++;
        return;
      }
      const invio = perInvio.get(f.id_invio) || {};
      conPosizione.push({
        idFoto: f.id_foto,
        nomeFile: f.nome_file,
        lat: lat,
        lon: lon,
        dataScatto: f.data_scatto,
        dataSopralluogo: invio.data_sopralluogo || '',
        volontario: invio.nome_volontario || invio.email_volontario || '',
        rivistaIl: f.rivista_il,
      });
    });
    conPosizione.sort((a, b) => (b.rivistaIl || '').localeCompare(a.rivistaIl || ''));

    risposta.status(200).json({
      foto: conPosizione.slice(0, LIMITE),
      totale: conPosizione.length,
      limite: LIMITE,
      senzaPosizione: senzaPosizione,
    });
  })(req, res);
};
