// GET /api/etichette   (qualsiasi utente abilitato)
// I tipi di problema per il menu «Che problema c'è?»: quelli attivi, in ordine, e «Altro» in fondo.
// "altro" dice alla pagina quale voce richiede una nota che spieghi il problema.
const { RUOLI, protetto } = require('../_lib/auth');
const { ALTRO, etichetteAttive } = require('../_lib/etichette');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI, async (richiesta, risposta) => {
    risposta.status(200).json({ etichette: (await etichetteAttive()).concat([ALTRO]), altro: ALTRO });
  })(req, res);
};
