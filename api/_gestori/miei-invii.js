// GET /api/miei-invii   (solo volontari)
// I propri invii (i 50 più recenti) con lo stato di ogni foto: in attesa, approvata o rifiutata (con il motivo).
// Ognuno vede solo i propri invii: il filtro è sull'email del biglietto di sessione, mai su un valore della richiesta.
const { protetto } = require('../_lib/auth');
const { leggiScheda } = require('../_lib/sheets');

const LIMITE = 50;
const STATI = ['in_attesa', 'approvata', 'rifiutata'];

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(['volontario'], async (richiesta, risposta, utente) => {
    const [invii, foto] = await Promise.all([leggiScheda('invii'), leggiScheda('foto')]);
    const miei = invii.filter((i) => String(i.email_volontario || '').toLowerCase() === utente.email);
    const perInvio = new Map();
    foto.forEach((f) => {
      if (!perInvio.has(f.id_invio)) perInvio.set(f.id_invio, []);
      perInvio.get(f.id_invio).push(f);
    });
    miei.sort((a, b) => String(b.data_invio || '').localeCompare(String(a.data_invio || '')));
    const risultato = miei.slice(0, LIMITE).map((i) => {
      const elenco = (perInvio.get(i.id_invio) || []).map((f) => ({
        nomeFile: f.nome_file,
        stato: STATI.includes(f.stato) ? f.stato : 'in_attesa',
        etichetta: f.etichetta || '',
        nota: f.nota || '',
        motivoRifiuto: f.stato === 'rifiutata' ? (f.motivo_rifiuto || '') : '',
        dataScatto: f.data_scatto || '',
        senzaPosizione: f.latitudine === '' || f.longitudine === '' || f.latitudine === undefined || f.longitudine === undefined,
      }));
      const conteggi = { in_attesa: 0, approvata: 0, rifiutata: 0 };
      elenco.forEach((f) => { conteggi[f.stato]++; });
      return {
        idInvio: i.id_invio,
        dataSopralluogo: i.data_sopralluogo || '',
        dataInvio: i.data_invio || '',
        settore: i.settore || '',
        sentiero: i.sentiero || '',
        conteggi,
        foto: elenco,
      };
    });
    risposta.setHeader('Cache-Control', 'no-store');
    risposta.status(200).json({ totale: miei.length, limite: LIMITE, invii: risultato });
  })(req, res);
};
