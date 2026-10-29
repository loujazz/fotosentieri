// GET /api/admin/foto?stato=in_attesa|approvata|rifiutata   (admin e super_admin)
// Elenco delle foto di uno stato (le 200 più recenti) con autore e data del sopralluogo, più i conteggi per stato.
const { RUOLI_ADMIN, protetto } = require('../../_lib/auth');
const { ErroApi, leggiScheda } = require('../../_lib/sheets');
const { costruisciFoto } = require('../../_lib/schedeFoto');

const STATI = ['in_attesa', 'approvata', 'rifiutata'];
const LIMITE = 200;

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

    const scelte = foto.filter((f) => f.stato === richiesto).map((f) => costruisciFoto(f, perInvio.get(f.id_invio)));
    scelte.sort((a, b) => (b.dataInvio || '').localeCompare(a.dataInvio || '') || (b.dataScatto || '').localeCompare(a.dataScatto || ''));

    risposta.status(200).json({ stato: richiesto, conteggi: conteggi, totale: scelte.length, limite: LIMITE, foto: scelte.slice(0, LIMITE) });
  })(req, res);
};
