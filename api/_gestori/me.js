// GET /api/me           (con "Authorization: Bearer <ID token>") -> { email, nome, ruolo }
// GET /api/me?config=1  (senza token)                          -> { clientId, dominio }
// La seconda forma serve solo alla pagina di accesso per sapere come configurare Google Sign-In.
const { RUOLI, protetto, risposta, dominioAmmesso } = require('../_lib/auth');
const { variabile } = require('../_lib/sheets');

const rispondiUtente = protetto(RUOLI, async (req, res, utente) => {
  res.status(200).json({ email: utente.email, nome: utente.nome, ruolo: utente.ruolo });
});

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  const parametri = new URL(req.url, 'http://localhost').searchParams;
  if (parametri.has('config')) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      return res.status(200).json({
        clientId: variabile('GOOGLE_CLIENT_ID'),
        dominio: dominioAmmesso(),
      });
    } catch (errore) {
      return risposta(res, errore);
    }
  }
  return rispondiUtente(req, res);
};
