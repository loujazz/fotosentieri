// GET /api/admin/sentieri-cerca?q=110   (admin e super_admin)
// Strumento per capire perché un sentiero non compare nel menu dei volontari. Cerca per numero (o parte del nome) tra TUTTI i
// percorsi sincronizzati, anche quelli che i volontari non vedono, e per ognuno dice se è visibile e, se no, il motivo:
//   - sta solo in settori spenti (si accendono dalla sezione «Settori»);
//   - non risulta dentro nessun settore (il tracciato non cade nei confini dei settori scaricati);
// Se non si trova niente, restituisce anche lo stato dell'ultima sincronizzazione (area cercata, percorsi saltati), per capire se il
// percorso non è stato scaricato.
// Risposta: { q, trovati: [{ id, ref, nome, da, a, comuni, sda, settori: [{ id, etichetta, attivo }], visibile, motivo }], sincronizzazione: {...} }
const { RUOLI_ADMIN, protetto } = require('../../_lib/auth');
const { ErroApi, leggiScheda } = require('../../_lib/sheets');
const { leggiDato } = require('../../_lib/drive');
const { DATI, leggiStato, leggiConfigurazione } = require('../../_lib/sincronizzazione');
const { nomeSenzaNumero } = require('../../_lib/sentieri');

const MAX_RISULTATI = 30;

function normalizza(testo) {
  return String(testo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function siAttivo(valore) {
  return String(valore || '').trim().toUpperCase().replace('Ì', 'I') === 'SI';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta) => {
    const q = (new URL(richiesta.url, 'http://localhost').searchParams.get('q') || '').trim();
    if (q.length < 1 || q.length > 40) throw new ErroApi(400, 'richiesta_non_valida', 'ricerca non valida');
    const cerca = normalizza(q);

    // Senza copia in memoria: qui serve il dato più recente.
    const [dati, righeSettori, stato] = await Promise.all([
      leggiDato(DATI.percorsi),
      leggiScheda('settori').catch((errore) => { if (errore instanceof ErroApi && errore.codice === 'errore_foglio') return []; throw errore; }),
      leggiStato(),
    ]);
    const percorsi = (dati && dati.percorsi) || [];
    const settori = new Map(righeSettori.filter((r) => r.id_osm2cai !== '').map((r) => [Number(r.id_osm2cai), {
      id: Number(r.id_osm2cai), etichetta: r.nome ? `${r.nome} (${r.codice})` : r.codice, attivo: siAttivo(r.attivo),
    }]));

    // Il numero esatto viene per primo, poi i numeri che cominciano così, poi il resto.
    const punteggio = (p) => {
      const ref = normalizza(p.ref);
      if (ref === cerca) return 0;
      if (ref.indexOf(cerca) === 0) return 1;
      return 2;
    };
    const trovati = percorsi
      .filter((p) => normalizza([p.ref, p.nome, p.da, p.a].join(' ')).indexOf(cerca) !== -1)
      .sort((a, b) => punteggio(a) - punteggio(b) || String(a.ref).localeCompare(String(b.ref), 'it', { numeric: true }))
      .slice(0, MAX_RISULTATI)
      .map((p) => {
        const dei = (p.settori || []).map((id) => settori.get(Number(id)) || { id: Number(id), etichetta: 'Settore ' + id, attivo: false });
        const attivi = dei.filter((s) => s.attivo);
        let motivo;
        if (attivi.length) motivo = 'Visibile ai volontari (settore ' + attivi.map((s) => s.etichetta).join(', ') + ').';
        else if (dei.length) motivo = 'Non è visibile: sta solo in settori spenti (' + dei.map((s) => s.etichetta).join(', ') + '). Accendi uno di questi settori in «Settori» e comparirà.';
        else motivo = 'Non è visibile: è stato scaricato ma non risulta dentro nessun settore (il suo tracciato non cade nei confini dei settori scaricati).';
        return {
          id: p.id, ref: p.ref, nome: nomeSenzaNumero(p), da: p.da, a: p.a, comuni: p.comuni || [], sda: p.sda === undefined ? null : p.sda,
          settori: dei, visibile: attivi.length > 0, motivo,
        };
      });

    let area = null;
    let sdaCercato = '';
    try {
      const cfg = await leggiConfigurazione();
      area = cfg.bbox;
      sdaCercato = cfg.sda;
    } catch (errore) { /* configurazione non valida: si vede già nella pagina «Sentieri» */ }
    risposta.setHeader('Cache-Control', 'no-store');
    risposta.status(200).json({
      q,
      trovati,
      sincronizzazione: {
        ultimaRiuscita: stato.ultimaRiuscita || null, percorsi: percorsi.length, area, sda: sdaCercato,
        saltati: (stato.saltati || []).slice(0, 50),
      },
    });
  })(req, res);
};
