// Client dell'API ufficiale di OSM2CAI (sola lettura, senza autenticazione): https://osm2cai.cai.it
// Richieste una alla volta e distanziate, con pochi nuovi tentativi: in passato un'area grande dava errore
// e il blocco 429. Se il server chiede di rallentare (429) si smette subito e si riprova al passo successivo.
const { ErroApi } = require('./sheets');

const BASE_PREDEFINITA = 'https://osm2cai.cai.it';
const TEMPO_MASSIMO_MS = 8000;
const TENTATIVI = 2;
const AGENTE = 'fotosentieri-cai-bologna (sincronizzazione notturna; contatto: catastorei@cai.it)';

function base() {
  // OSM2CAI_URL serve solo alle prove (un finto server) o a una copia dei dati: normalmente non si imposta.
  return (process.env.OSM2CAI_URL || BASE_PREDEFINITA).replace(/\/+$/, '');
}

function pausa(ms) {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

function pausaTraRichieste() {
  const ms = process.env.OSM2CAI_PAUSA_MS !== undefined ? Number(process.env.OSM2CAI_PAUSA_MS) : 250;
  return ms > 0 ? pausa(ms) : Promise.resolve();
}

// Restituisce il JSON della risposta. Errori: ErroApi 'osm2cai_rallentato' (429), 'osm2cai_non_trovato' (404),
// 'osm2cai_errore' (altro).
async function chiedi(percorso) {
  const url = base() + percorso;
  let ultimo = null;
  for (let tentativo = 1; tentativo <= TENTATIVI; tentativo++) {
    try {
      const risposta = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': AGENTE },
        signal: AbortSignal.timeout(TEMPO_MASSIMO_MS),
      });
      if (risposta.status === 429) throw new ErroApi(503, 'osm2cai_rallentato', 'OSM2CAI chiede di rallentare (429)');
      if (risposta.status === 404) throw new ErroApi(404, 'osm2cai_non_trovato', `Non trovato: ${percorso}`);
      if (!risposta.ok) throw new ErroApi(502, 'osm2cai_errore', `OSM2CAI ha risposto ${risposta.status} a ${percorso}`);
      const corpo = await risposta.json();
      await pausaTraRichieste();
      return corpo;
    } catch (errore) {
      if (errore instanceof ErroApi && errore.codice !== 'osm2cai_errore') throw errore; // 429 e 404 non si ritentano
      ultimo = errore instanceof ErroApi ? errore : new ErroApi(502, 'osm2cai_errore', `Richiesta a OSM2CAI non riuscita (${errore && errore.name}): ${percorso}`);
      if (tentativo < TENTATIVI) await pausa(500);
    }
  }
  throw ultimo;
}

const bboxTesto = (b) => b.join(',');

module.exports = {
  // [{ id, updated_at, name: { it } }]
  listaSettori: (bbox) => chiedi(`/api/v3/sectors/list?bbox=${bboxTesto(bbox)}`),
  // Feature GeoJSON con MultiPolygon
  dettaglioSettore: (id) => chiedi(`/api/v3/sectors/${encodeURIComponent(id)}`),
  // { "id": "YYYY-MM-DD HH:MM:SS" }
  percorsiInRiquadro: (bbox, sda) => chiedi(`/api/v2/hiking-routes/bb/${bboxTesto(bbox)}/${encodeURIComponent(sda)}`),
  // Feature GeoJSON con MultiLineString
  dettaglioPercorso: (id) => chiedi(`/api/v2/hiking-route/${encodeURIComponent(id)}`),
};
