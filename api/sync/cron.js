// GET /api/sync/cron   (chiamata automatica ogni notte)
// Esegue UN passo della sincronizzazione. Non usa la sessione degli utenti: si autentica con il segreto
// CRON_SECRET nell'intestazione «Authorization: Bearer <segreto>». Vercel lo invia da solo se la variabile
// CRON_SECRET esiste; su un altro hosting basta un'operazione pianificata (cron) che chiami questo indirizzo
// con la stessa intestazione, per esempio:  curl -H "Authorization: Bearer $CRON_SECRET" https://sito/api/sync/cron
const crypto = require('crypto');
const { ErroApi, variabile } = require('../_lib/sheets');
const { risposta } = require('../_lib/auth');
const { passo } = require('../_lib/sincronizzazione');

function segretoValido(intestazione) {
  const atteso = Buffer.from(variabile('CRON_SECRET'));
  const m = /^Bearer (.+)$/i.exec(intestazione || '');
  if (!m) return false;
  const ricevuto = Buffer.from(m[1]);
  return ricevuto.length === atteso.length && crypto.timingSafeEqual(ricevuto, atteso);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      throw new ErroApi(405, 'metodo_non_ammesso');
    }
    if (!segretoValido(req.headers.authorization)) throw new ErroApi(401, 'non_autorizzato');
    res.status(200).json(await passo({}));
  } catch (errore) {
    risposta(res, errore);
  }
};
