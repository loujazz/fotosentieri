// GET /api/admin/foto?stato=in_attesa|approvata|rifiutata   (admin e super_admin)
// Elenco delle foto di uno stato (le 200 più recenti) con autore e data del sopralluogo, più i conteggi per stato.
const { RUOLI_ADMIN, protetto } = require('../_lib/auth');
const { ErroApi, leggiScheda } = require('../_lib/sheets');

const STATI = ['in_attesa', 'approvata', 'rifiutata'];
const LIMITE = 200;

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
    const richiesto = new URL(richiesta.url, 'http://localhost').searchParams.get('stato') || 'in_attesa';
    if (!STATI.includes(richiesto)) throw new ErroApi(400, 'richiesta_non_valida', 'stato non valido');

    const [foto, invii] = await Promise.all([leggiScheda('foto'), leggiScheda('invii')]);
    const perInvio = new Map(invii.map((i) => [i.id_invio, i]));
    const conteggi = { in_attesa: 0, approvata: 0, rifiutata: 0 };
    foto.forEach((f) => { if (STATI.includes(f.stato)) conteggi[f.stato]++; });

    const scelte = foto.filter((f) => f.stato === richiesto).map((f) => {
      const invio = perInvio.get(f.id_invio) || {};
      return {
        idFoto: f.id_foto,
        nomeFile: f.nome_file,
        lat: numero(f.latitudine),
        lon: numero(f.longitudine),
        fontePosizione: f.fonte_posizione,
        dataScatto: f.data_scatto,
        stato: f.stato,
        rivistaDa: f.rivista_da,
        rivistaIl: f.rivista_il,
        motivoRifiuto: f.motivo_rifiuto,
        volontario: { nome: invio.nome_volontario || '', email: invio.email_volontario || '' },
        dataSopralluogo: invio.data_sopralluogo || '',
        dataInvio: invio.data_invio || '',
      };
    });
    scelte.sort((a, b) => (b.dataInvio || '').localeCompare(a.dataInvio || '') || (b.dataScatto || '').localeCompare(a.dataScatto || ''));

    risposta.status(200).json({ stato: richiesto, conteggi: conteggi, totale: scelte.length, limite: LIMITE, foto: scelte.slice(0, LIMITE) });
  })(req, res);
};
