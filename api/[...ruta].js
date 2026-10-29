// Unico punto d'ingresso di tutte le funzioni del server (Vercel conta ogni file di api/ come una
// funzione, e il piano Hobby ne ammette 12). Gli indirizzi non cambiano: /api/admin/foto, /api/me, ...
// I gestori stanno in api/_gestori (la cartella con il trattino basso non diventa una funzione).
// Gli elenchi sono scritti per esteso, senza require dinamici, perché Vercel includa i file giusti.
const percorsi = {
  'me': require('./_gestori/me'),
  'sessione': require('./_gestori/sessione'),
  'etichette': require('./_gestori/etichette'),
  'carica/avvia': require('./_gestori/carica/avvia'),
  'carica/conferma': require('./_gestori/carica/conferma'),
  'admin/foto': require('./_gestori/admin/foto'),
  'admin/anteprima': require('./_gestori/admin/anteprima'),
  'admin/revisione': require('./_gestori/admin/revisione'),
  'admin/mappa': require('./_gestori/admin/mappa'),
  'admin/categorie': require('./_gestori/admin/categorie'),
  'admin/settori': require('./_gestori/admin/settori'),
  'admin/sync': require('./_gestori/admin/sync'),
  'sync/cron': require('./_gestori/sync/cron'),
};

function percorsoRichiesto(req) {
  const nome = new URL(req.url, 'http://localhost').pathname;
  return nome.replace(/^\/api\//, '').replace(/\/+$/, '');
}

module.exports = async (req, res) => {
  const gestore = Object.prototype.hasOwnProperty.call(percorsi, percorsoRichiesto(req))
    ? percorsi[percorsoRichiesto(req)]
    : null;
  if (!gestore) return res.status(404).json({ errore: 'non_trovato' });
  return gestore(req, res);
};

module.exports.percorsi = percorsi;
