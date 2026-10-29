// Sincronizzazione con OSM2CAI   (admin e super_admin)
//   GET  /api/admin/sync                       -> stato (ultima riuscita, fase, avanzamento, errore)
//   POST /api/admin/sync { riparti?: boolean } -> esegue UN passo (al massimo ~45 secondi) e restituisce lo stato.
//        La pagina ripete la chiamata finché "inCorso" è false: è il pulsante «Aggiorna ora».
// Se un altro passo è in corso (per esempio quello notturno) la risposta ha "occupata": true.
const { RUOLI_ADMIN, protetto } = require('../../_lib/auth');
const { passo, leggiStato, riassunto } = require('../../_lib/sincronizzazione');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta) => {
    if (richiesta.method === 'GET') {
      return risposta.status(200).json(riassunto(await leggiStato()));
    }
    const corpo = richiesta.body && typeof richiesta.body === 'object' ? richiesta.body : {};
    risposta.status(200).json(await passo({ riparti: corpo.riparti === true }));
  })(req, res);
};
