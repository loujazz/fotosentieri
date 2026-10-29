// GET /api/etichette   (qualsiasi utente abilitato)
// Le etichette attive, in ordine, per il menu «Che problema c'è?» di chi carica le foto.
const { RUOLI, protetto } = require('./_lib/auth');
const { etichetteAttive } = require('./_lib/etichette');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI, async (richiesta, risposta) => {
    risposta.status(200).json({ etichette: await etichetteAttive() });
  })(req, res);
};
