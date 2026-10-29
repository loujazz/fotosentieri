// Categorie dei problemi (etichette)   (admin e super_admin)
//   GET  /api/admin/categorie  -> { categorie: [{ nome, attiva, ordine, usi }], altro, usiAltro }
//   POST /api/admin/categorie  -> stessa risposta dopo la modifica. Corpo, uno tra:
//        { azione: 'aggiungi', nome }
//        { azione: 'attiva', nome, attiva: true | false }
//        { azione: 'sposta', nome, direzione: 'su' | 'giu' }
// Le categorie non si cancellano né si rinominano (le foto già inviate le conservano): si disattivano.
// «Altro» è riservata: c'è sempre e non si può creare né modificare.
const { RUOLI_ADMIN, protetto } = require('../_lib/auth');
const { ErroApi, leggiScheda, aggiungiRighe, aggiornaCelle } = require('../_lib/sheets');
const { ALTRO, MAX_NOME, tutteLeEtichette, normalizzaNome, stessoNome } = require('../_lib/etichette');

function richiestaNonValida(motivo) {
  return new ErroApi(400, 'richiesta_non_valida', motivo);
}

function leggiCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (errore) {
    throw richiestaNonValida('corpo non valido');
  }
}

async function elenco() {
  const [categorie, foto] = await Promise.all([tutteLeEtichette(), leggiScheda('foto')]);
  const usi = new Map();
  foto.forEach((f) => {
    const k = (f.etichetta || '').trim().toLowerCase();
    if (k) usi.set(k, (usi.get(k) || 0) + 1);
  });
  return {
    categorie: categorie.map((c) => ({ nome: c.nome, attiva: c.attiva, ordine: c.ordine, usi: usi.get(c.nome.toLowerCase()) || 0 })),
    altro: ALTRO,
    usiAltro: usi.get(ALTRO.toLowerCase()) || 0,
  };
}

// Rinumera le categorie da 1 a N nell'ordine dato, cambiando solo le celle "ordine" che differiscono.
function rinumera(ordinate) {
  return ordinate
    .map((c, i) => ({ riga: c.riga, valori: { ordine: i + 1 }, cambia: c.ordine !== i + 1 }))
    .filter((m) => m.cambia)
    .map((m) => ({ riga: m.riga, valori: m.valori }));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta) => {
    if (richiesta.method === 'POST') {
      const corpo = leggiCorpo(richiesta);
      const categorie = await tutteLeEtichette();

      if (corpo.azione === 'aggiungi') {
        const nome = normalizzaNome(corpo.nome);
        if (nome.length < 2 || nome.length > MAX_NOME) throw new ErroApi(400, 'nome_non_valido');
        if (stessoNome(nome, ALTRO)) throw new ErroApi(400, 'nome_riservato');
        if (categorie.some((c) => stessoNome(c.nome, nome))) throw new ErroApi(409, 'categoria_esistente');
        const ultimo = categorie.reduce((massimo, c) => Math.max(massimo, c.ordine < 1e6 ? c.ordine : 0), 0);
        await aggiungiRighe('etichette', [{ etichetta: nome, attiva: 'SI', ordine: ultimo + 1 }]);
      } else if (corpo.azione === 'attiva') {
        if (typeof corpo.nome !== 'string' || typeof corpo.attiva !== 'boolean') throw richiestaNonValida('dati mancanti');
        const c = categorie.find((x) => stessoNome(x.nome, corpo.nome));
        if (!c) throw new ErroApi(404, 'categoria_non_trovata');
        await aggiornaCelle('etichette', [{ riga: c.riga, valori: { attiva: corpo.attiva ? 'SI' : 'NO' } }]);
      } else if (corpo.azione === 'sposta') {
        if (typeof corpo.nome !== 'string' || (corpo.direzione !== 'su' && corpo.direzione !== 'giu')) throw richiestaNonValida('dati mancanti');
        const i = categorie.findIndex((x) => stessoNome(x.nome, corpo.nome));
        if (i === -1) throw new ErroApi(404, 'categoria_non_trovata');
        const j = corpo.direzione === 'su' ? i - 1 : i + 1;
        if (j >= 0 && j < categorie.length) {
          const ordinate = categorie.slice();
          [ordinate[i], ordinate[j]] = [ordinate[j], ordinate[i]];
          await aggiornaCelle('etichette', rinumera(ordinate));
        }
      } else {
        throw richiestaNonValida('azione non valida');
      }
    }
    risposta.status(200).json(await elenco());
  })(req, res);
};
