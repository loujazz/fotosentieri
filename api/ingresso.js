// Unico punto d'ingresso di tutte le funzioni del server (Vercel conta ogni file di api/ come una
// funzione, e il piano Hobby ne ammette 12). Gli indirizzi non cambiano: /api/admin/foto, /api/me, ...
// Su Vercel una regola di vercel.json inoltra /api/<percorso> a /api/ingresso?ruta=<percorso>
// (un file «[...ruta].js» smistava solo gli indirizzi a una parte, non quelli come /api/admin/foto).
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

// Ricava il percorso richiesto (dal parametro «ruta» della regola di inoltro, oppure dall'indirizzo)
// e rimette in req.url l'indirizzo originale senza «ruta», perché i gestori leggono da lì i loro parametri.
function normalizza(req) {
  const url = new URL(req.url, 'http://localhost');
  let nome = url.searchParams.get('ruta');
  if (nome === null) {
    nome = url.pathname.replace(/^\/api\//, '');
  } else {
    url.searchParams.delete('ruta');
    req.url = '/api/' + nome.replace(/^\/+/, '') + url.search;
  }
  return nome.replace(/^\/+|\/+$/g, '');
}

module.exports = async (req, res) => {
  const nome = normalizza(req);
  const gestore = Object.prototype.hasOwnProperty.call(percorsi, nome) ? percorsi[nome] : null;
  if (!gestore) return res.status(404).json({ errore: 'non_trovato' });
  return gestore(req, res);
};

module.exports.percorsi = percorsi;
