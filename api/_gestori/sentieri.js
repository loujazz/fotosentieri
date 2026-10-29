// GET /api/sentieri   (qualsiasi utente abilitato)
// Il menu settore -> sentiero (solo settori attivi) con i comuni di ogni sentiero, per il volontario che invia le
// foto e per la sezione «Sentieri per comune» degli admin. Legge i dati già sincronizzati, mai il server del CAI.
const { RUOLI, protetto } = require('../_lib/auth');
const { menuSentieri } = require('../_lib/sentieri');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI, async (richiesta, risposta) => {
    risposta.setHeader('Cache-Control', 'no-store');
    risposta.status(200).json(await menuSentieri());
  })(req, res);
};
