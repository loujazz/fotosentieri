// Sincronizzazione dei settori e dei percorsi validati di OSM2CAI.
//
// Lavora a PICCOLI PASSI riprendibili: ogni chiamata a passo() fa quanto può entro un tempo limite, salva dove è
// arrivata e si ferma; la chiamata dopo riprende da lì. Così funziona con i limiti brevi delle funzioni
// (Vercel Hobby) e, su un altro hosting, con un semplice cron che chiama lo stesso indirizzo.
//
// Fasi di un giro:  inizio -> settori -> elenco -> percorsi -> chiusura -> riposo
//   inizio    elenco dei settori dell'area; si scaricano solo quelli nuovi o cambiati (updated_at)
//   settori   dettaglio dei settori da scaricare (confini)
//   elenco    id e date di aggiornamento dei percorsi, per riquadri piccoli e distanziati
//   percorsi  dettaglio dei soli percorsi nuovi o cambiati
//   chiusura  assegna ogni percorso ai settori, scrive i file finali, aggiorna la scheda "settori"
//
// Dati (file JSON nel Drive condiviso, vedi drive.js): settori, settori-confini, percorsi, percorsi-geometrie,
// più sync-stato e sync-lavoro per i passi in corso. Se un giro fallisce, i dati finali restano quelli
// dell'ultima sincronizzazione riuscita.
const osm = require('./osm2cai');
const geo = require('./geometria');
const { leggiDato, scriviDato } = require('./drive');
const { ErroApi, leggiScheda, aggiungiRighe, assicuraScheda } = require('./sheets');

const DATI = { stato: 'sync-stato', lavoro: 'sync-lavoro', settori: 'settori', confini: 'settori-confini', percorsi: 'percorsi', geometrie: 'percorsi-geometrie' };
const PREDEFINITI = { area_bbox: '10.9,44.0,11.8,44.7', sda: '4', prefisso_settori: 'HBO' };
const CELLA_LON = 0.2;
const CELLA_LAT = 0.1;
const TOLLERANZA_PERCORSI = 0.00004; // ~4,5 metri
const TOLLERANZA_CONFINI = 0.00003; // ~3 metri
const SALVATAGGIO_OGNI_MS = 8000;
const GIRO_TROPPO_VECCHIO_MS = 3 * 24 * 3600 * 1000;
const INTESTAZIONI_SETTORI = ['id_osm2cai', 'codice', 'nome', 'attivo', 'aggiornato_il'];

// Un nome dal CAI può arrivare come testo o come oggetto per lingua ({ it: "..." }): nelle celle del foglio solo testo.
function testoNome(valore) {
  if (valore === null || valore === undefined) return '';
  if (typeof valore === 'string') return valore.trim();
  if (typeof valore === 'object') return testoNome(valore.it !== undefined ? valore.it : Object.values(valore)[0]);
  return String(valore).trim();
}

function adesso() {
  return new Date().toISOString();
}

function budgetMs() {
  const v = Number(process.env.SYNC_BUDGET_MS);
  return Number.isFinite(v) && v > 0 ? v : 45000;
}

// ---- configurazione (scheda "configurazione": chiave, valore), con valori di partenza ----
async function leggiConfigurazione() {
  let righe = [];
  try {
    righe = await leggiScheda('configurazione');
  } catch (errore) {
    console.error('Sincronizzazione: scheda "configurazione" non leggibile, si usano i valori di partenza');
  }
  const valori = Object.assign({}, PREDEFINITI);
  righe.forEach((r) => { if (r.chiave && r.valore !== '' && Object.prototype.hasOwnProperty.call(PREDEFINITI, r.chiave)) valori[r.chiave] = r.valore; });
  const bbox = String(valori.area_bbox).split(',').map((x) => Number(x.trim()));
  if (bbox.length !== 4 || bbox.some((x) => !Number.isFinite(x)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3] ||
      bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90) {
    throw new ErroApi(500, 'configurazione', 'area_bbox nella scheda "configurazione" non è valida (ovest,sud,est,nord)');
  }
  if (!/^[0-4](,[0-4])*$/.test(String(valori.sda).replace(/\s/g, ''))) {
    throw new ErroApi(500, 'configurazione', 'sda nella scheda "configurazione" non è valido (numeri da 0 a 4)');
  }
  return { bbox, sda: String(valori.sda).replace(/\s/g, ''), prefisso: String(valori.prefisso_settori || '').trim() };
}

// Riquadri piccoli che coprono l'area: il server del CAI ha dato errore e il blocco 429 con aree grandi.
function celle(bbox) {
  const risultato = [];
  for (let s = bbox[1]; s < bbox[3]; s += CELLA_LAT) {
    for (let w = bbox[0]; w < bbox[2]; w += CELLA_LON) {
      const arr = (n) => Math.round(n * 1e6) / 1e6;
      risultato.push([arr(w), arr(s), arr(Math.min(w + CELLA_LON, bbox[2])), arr(Math.min(s + CELLA_LAT, bbox[3]))]);
    }
  }
  return risultato;
}

// ---- stato ----
function statoIniziale() {
  return { versione: 1, fase: 'riposo', avviata: null, aggiornata: null, lease: 0, ultimaRiuscita: null, errore: null, avanzamento: { fatti: 0, totale: 0 }, saltati: [], conteggi: { settori: 0, percorsi: 0 } };
}

function nuovoGiro(stato) {
  return Object.assign(stato, {
    fase: 'inizio', avviata: adesso(), errore: null, avanzamento: { fatti: 0, totale: 0 }, saltati: [],
    coda: { settori: [], percorsi: [] }, listaSettori: [], celle: [], cursoreCella: 0, elenco: {},
  });
}

function lavoroVuoto() {
  return { settori: {}, percorsi: {} };
}

const DESCRIZIONI = {
  inizio: 'Controllo dei settori', settori: 'Scarico dei confini dei settori', elenco: 'Elenco dei percorsi',
  percorsi: 'Scarico dei percorsi nuovi o cambiati', chiusura: 'Salvataggio dei dati', riposo: 'Nessuna sincronizzazione in corso',
};

// Riassunto per la pagina degli admin (senza dati pesanti).
function riassunto(stato) {
  return {
    fase: stato.fase,
    descrizione: DESCRIZIONI[stato.fase] || stato.fase,
    inCorso: stato.fase !== 'riposo',
    occupata: Boolean(stato.lease && stato.lease > Date.now()),
    avanzamento: stato.avanzamento,
    ultimaRiuscita: stato.ultimaRiuscita,
    errore: stato.errore,
    saltati: (stato.saltati || []).length,
    saltatiElenco: (stato.saltati || []).slice(0, 5),
    conteggi: stato.conteggi,
  };
}

async function leggiStato() {
  return (await leggiDato(DATI.stato)) || statoIniziale();
}

// ---- fasi ----
function erroreDi(errore) {
  return {
    codice: errore instanceof ErroApi ? errore.codice : 'errore_imprevisto',
    messaggio: errore && errore.message ? String(errore.message).slice(0, 300) : 'Errore sconosciuto',
    quando: adesso(),
  };
}

async function faseInizio(ctx) {
  const { stato, cfg } = ctx;
  const lista = await osm.listaSettori(cfg.bbox);
  if (!Array.isArray(lista)) throw new ErroApi(502, 'osm2cai_risposta', 'Elenco dei settori in un formato inatteso');
  const salvati = (await leggiDato(DATI.settori)) || { settori: [] };
  if (lista.length === 0 && salvati.settori.length > 0) {
    throw new ErroApi(502, 'osm2cai_elenco_vuoto', 'OSM2CAI ha restituito zero settori: si tengono i dati precedenti');
  }
  const confini = (await leggiDato(DATI.confini)) || {};
  const perId = new Map(salvati.settori.map((x) => [x.id, x]));
  stato.listaSettori = lista.map((x) => ({ id: x.id, updated_at: x.updated_at, codice: x.name && x.name.it }));
  stato.coda.settori = lista.filter((x) => { const v = perId.get(x.id); return !v || v.updated_at !== x.updated_at || !confini[x.id]; }).map((x) => x.id);
  stato.avanzamento = { fatti: 0, totale: stato.coda.settori.length };
  stato.fase = 'settori';
}

async function faseSettori(ctx) {
  const { stato, lavoro } = ctx;
  while (stato.coda.settori.length) {
    if (ctx.finito()) return;
    const id = stato.coda.settori[0];
    try {
      const d = await osm.dettaglioSettore(id);
      const poligoni = d && d.geometry && d.geometry.type === 'MultiPolygon' ? d.geometry.coordinates : null;
      if (!poligoni) throw new ErroApi(502, 'osm2cai_risposta', `Il settore ${id} non ha confini validi`);
      const semplici = poligoni.map((poligono) => poligono
        .map((anello) => geo.arrotonda(geo.semplifica(anello, TOLLERANZA_CONFINI), 5))
        .filter((anello) => anello.length >= 4));
      const p = d.properties || {};
      const voce = stato.listaSettori.find((x) => x.id === id) || {};
      lavoro.settori[id] = {
        id, codice: String(p.full_code || (p.name && p.name.it) || voce.codice || id),
        nome_cai: testoNome(p.human_name), updated_at: voce.updated_at || p.updated_at || '',
        riquadro: geo.riquadro(semplici.flatMap((poligono) => poligono)), poligoni: semplici,
      };
    } catch (errore) {
      if (!(errore instanceof ErroApi) || errore.codice !== 'osm2cai_non_trovato') throw errore;
      stato.saltati.push(`settore ${id}`);
    }
    stato.coda.settori.shift();
    stato.avanzamento.fatti++;
    ctx.modificato();
  }
  stato.celle = celle(ctx.cfg.bbox);
  stato.cursoreCella = 0;
  stato.elenco = {};
  stato.avanzamento = { fatti: 0, totale: stato.celle.length };
  stato.fase = 'elenco';
}

async function faseElenco(ctx) {
  const { stato, cfg } = ctx;
  while (stato.cursoreCella < stato.celle.length) {
    if (ctx.finito()) return;
    let ids = await osm.percorsiInRiquadro(stato.celle[stato.cursoreCella], cfg.sda);
    // Un riquadro senza percorsi può tornare come [] (elenco vuoto, come fanno i server PHP) invece che {}.
    if (Array.isArray(ids) && ids.length === 0) ids = {};
    if (!ids || typeof ids !== 'object' || Array.isArray(ids)) {
      const visto = Array.isArray(ids) ? 'un elenco' : (ids === null ? 'null' : typeof ids);
      throw new ErroApi(502, 'osm2cai_risposta', `Elenco dei percorsi in un formato inatteso (riquadro ${stato.celle[stato.cursoreCella].join(',')}, ricevuto ${visto})`);
    }
    Object.keys(ids).forEach((id) => { stato.elenco[id] = ids[id]; });
    stato.cursoreCella++;
    stato.avanzamento.fatti = stato.cursoreCella;
    ctx.modificato();
  }
  const salvati = (await leggiDato(DATI.percorsi)) || { percorsi: [] };
  const trovati = Object.keys(stato.elenco);
  if (trovati.length === 0 && salvati.percorsi.length > 0) {
    throw new ErroApi(502, 'osm2cai_elenco_vuoto', 'OSM2CAI ha restituito zero percorsi: si tengono i dati precedenti');
  }
  const perId = new Map(salvati.percorsi.map((p) => [String(p.id), p]));
  stato.coda.percorsi = trovati.filter((id) => { const v = perId.get(id); return !v || v.updated_at !== stato.elenco[id]; });
  stato.avanzamento = { fatti: 0, totale: stato.coda.percorsi.length };
  stato.fase = 'percorsi';
}

function percorsoDaFeature(f, aggiornato) {
  const p = (f && f.properties) || {};
  const linee = geo.lineeDi(f && f.geometry)
    .map((linea) => geo.arrotonda(geo.semplifica(linea, TOLLERANZA_PERCORSI), 5))
    .filter((linea) => linea.length >= 2);
  if (!p.id || linee.length === 0) throw new ErroApi(502, 'osm2cai_risposta', 'Percorso senza identificativo o senza tracciato');
  return {
    meta: {
      id: Number(p.id), ref: String(p.ref || ''), nome: String((p.name && p.name.it) || ''), da: String(p.from || ''), a: String(p.to || ''),
      sda: p.sda === undefined ? null : Number(p.sda), difficolta: String(p.cai_scale || ''),
      lunghezza: Number.isFinite(Number(p.distance)) ? Number(p.distance) : null, stato: String(p.issues_status || ''),
      comuni: Object.values(p.taxonomy_where || {}).map((x) => x && x.it).filter(Boolean),
      updated_at: aggiornato || String(p.updated_at || ''),
    },
    linee,
  };
}

async function fasePercorsi(ctx) {
  const { stato, lavoro } = ctx;
  while (stato.coda.percorsi.length) {
    if (ctx.finito()) return;
    const id = stato.coda.percorsi[0];
    try {
      const f = await osm.dettaglioPercorso(id);
      const { meta, linee } = percorsoDaFeature(f, stato.elenco[id]);
      lavoro.percorsi[id] = { meta, c: linee };
    } catch (errore) {
      if (!(errore instanceof ErroApi) || !['osm2cai_non_trovato', 'osm2cai_risposta'].includes(errore.codice)) throw errore;
      // Si annota anche il perché: un percorso saltato non compare mai ai volontari (si vede in «Sentieri» → «Cerca un sentiero»).
      stato.saltati.push(`percorso ${id} (${errore.codice === 'osm2cai_non_trovato' ? 'il CAI non lo trova' : 'senza tracciato o dati incompleti'})`);
    }
    stato.coda.percorsi.shift();
    stato.avanzamento.fatti++;
    ctx.modificato();
  }
  stato.fase = 'chiusura';
}

async function nuoviSettoriNelFoglio(settori, prefisso) {
  await assicuraScheda('settori', INTESTAZIONI_SETTORI);
  const esistenti = new Set((await leggiScheda('settori')).map((r) => String(r.id_osm2cai)));
  const nuovi = settori.filter((s) => !esistenti.has(String(s.id)));
  // I settori nuovi partono attivi solo se il codice comincia con il prefisso della sezione; gli admin li correggono dal sito.
  await aggiungiRighe('settori', nuovi.map((s) => ({
    id_osm2cai: s.id, codice: String(s.codice || ''), nome: testoNome(s.nome_cai),
    attivo: prefisso && s.codice.toUpperCase().startsWith(prefisso.toUpperCase()) ? 'SI' : 'NO', aggiornato_il: adesso(),
  })));
  return nuovi.length;
}

async function faseChiusura(ctx) {
  const { stato, lavoro, cfg } = ctx;
  const salvatiSettori = (await leggiDato(DATI.settori)) || { settori: [] };
  const salvatiConfini = (await leggiDato(DATI.confini)) || {};
  const salvatiPercorsi = (await leggiDato(DATI.percorsi)) || { percorsi: [] };
  const salvateGeometrie = (await leggiDato(DATI.geometrie)) || {};

  // Settori: solo quelli ancora presenti nell'elenco del CAI.
  const perId = new Map(salvatiSettori.settori.map((x) => [x.id, x]));
  const settori = [];
  const confini = {};
  stato.listaSettori.forEach((voce) => {
    const nuovo = lavoro.settori[voce.id];
    if (nuovo) {
      settori.push({ id: nuovo.id, codice: nuovo.codice, nome_cai: nuovo.nome_cai, updated_at: nuovo.updated_at });
      confini[voce.id] = { riquadro: nuovo.riquadro, poligoni: nuovo.poligoni };
    } else if (perId.has(voce.id) && salvatiConfini[voce.id]) {
      settori.push(perId.get(voce.id));
      confini[voce.id] = salvatiConfini[voce.id];
    }
  });
  const elencoSettori = settori.map((s) => ({ id: s.id, riquadro: confini[s.id].riquadro, poligoni: confini[s.id].poligoni }));

  // Percorsi: quelli nell'elenco del CAI; i cambiati dal lavoro, gli altri dalla copia precedente.
  const vecchi = new Map(salvatiPercorsi.percorsi.map((p) => [String(p.id), p]));
  const percorsi = [];
  const geometrie = {};
  Object.keys(stato.elenco).forEach((id) => {
    const nuovo = lavoro.percorsi[id];
    let meta;
    let linee;
    if (nuovo) { meta = nuovo.meta; linee = nuovo.c; } else if (vecchi.has(id) && salvateGeometrie[id]) { meta = vecchi.get(id); linee = salvateGeometrie[id].c; } else return;
    percorsi.push(Object.assign({}, meta, { settori: geo.settoriDelTracciato(linee, elencoSettori) }));
    geometrie[id] = { c: linee };
  });
  percorsi.sort((a, b) => a.ref.localeCompare(b.ref, 'it', { numeric: true }) || a.id - b.id);

  const aggiornato = adesso();
  await scriviDato(DATI.confini, confini);
  await scriviDato(DATI.geometrie, geometrie);
  await scriviDato(DATI.percorsi, { aggiornato, bbox: cfg.bbox, sda: cfg.sda, percorsi });
  await scriviDato(DATI.settori, { aggiornato, settori });

  let nuoviNelFoglio = 0;
  try {
    nuoviNelFoglio = await nuoviSettoriNelFoglio(settori, cfg.prefisso);
  } catch (errore) {
    // I dati sincronizzati sono già salvati: un problema con la scheda "settori" non li invalida, ma si segnala.
    stato.saltati.push('scheda settori non aggiornata');
    console.error('Sincronizzazione: scheda "settori" non aggiornata:', errore && errore.message);
  }

  stato.fase = 'riposo';
  stato.ultimaRiuscita = aggiornato;
  stato.errore = null;
  stato.conteggi = { settori: settori.length, percorsi: percorsi.length, settoriNuovi: nuoviNelFoglio };
  stato.coda = { settori: [], percorsi: [] };
  stato.elenco = {};
  stato.celle = [];
  lavoro.settori = {};
  lavoro.percorsi = {};
  ctx.modificato();
}

// ---- passo ----
// opzioni.riparti: ricomincia da capo anche se un giro è a metà (per uscire da un errore che si ripete).
async function passo(opzioni) {
  const inizio = Date.now();
  const budget = budgetMs();
  let stato = await leggiStato();
  if (stato.lease && stato.lease > inizio) return Object.assign(riassunto(stato), { occupata: true });

  let cfg;
  try {
    cfg = await leggiConfigurazione();
  } catch (errore) {
    stato.errore = erroreDi(errore); // una configurazione sbagliata si vede nella pagina degli admin
    stato.aggiornata = adesso();
    await scriviDato(DATI.stato, stato);
    return riassunto(stato);
  }
  const vecchio = stato.avviata && inizio - Date.parse(stato.avviata) > GIRO_TROPPO_VECCHIO_MS;
  if (stato.fase === 'riposo' || (opzioni && opzioni.riparti) || vecchio || !stato.coda) {
    stato = nuovoGiro(stato);
  }
  stato.lease = inizio + budget + 20000; // protegge da passi sovrapposti
  stato.errore = null; // un nuovo tentativo riparte pulito: se fallisce di nuovo, l'errore si riscrive
  await scriviDato(DATI.stato, stato);

  let lavoro = stato.fase === 'inizio' ? lavoroVuoto() : ((await leggiDato(DATI.lavoro)) || lavoroVuoto());
  let sporco = true;
  let ultimoSalvataggio = Date.now();
  const ctx = {
    stato, lavoro, cfg,
    finito: () => Date.now() - inizio > budget,
    modificato: () => { sporco = true; },
  };
  const salva = async () => {
    stato.aggiornata = adesso();
    await scriviDato(DATI.lavoro, ctx.lavoro);
    await scriviDato(DATI.stato, stato);
    sporco = false;
    ultimoSalvataggio = Date.now();
  };

  try {
    while (!ctx.finito() && stato.fase !== 'riposo') {
      const fase = stato.fase;
      if (fase === 'inizio') await faseInizio(ctx);
      else if (fase === 'settori') await faseSettori(ctx);
      else if (fase === 'elenco') await faseElenco(ctx);
      else if (fase === 'percorsi') await fasePercorsi(ctx);
      else if (fase === 'chiusura') await faseChiusura(ctx);
      else break;
      if (sporco && Date.now() - ultimoSalvataggio > SALVATAGGIO_OGNI_MS) await salva();
    }
  } catch (errore) {
    stato.errore = erroreDi(errore);
    console.error('Sincronizzazione interrotta:', stato.errore.codice, stato.errore.messaggio);
  } finally {
    stato.lease = 0;
    try {
      await salva();
    } catch (errore) {
      console.error('Sincronizzazione: salvataggio dello stato non riuscito:', errore && errore.message);
    }
  }
  return riassunto(stato);
}

module.exports = { passo, leggiStato, riassunto, leggiConfigurazione, celle, DATI };
