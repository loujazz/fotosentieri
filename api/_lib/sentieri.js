// Menu settore -> sentiero, costruito dai dati sincronizzati con OSM2CAI (file nel Drive condiviso) e dalla
// scheda "settori" del foglio (nome e «attivo» li decidono gli admin). I volontari vedono solo i settori attivi
// e i sentieri che ci stanno dentro. I dati non si scaricano mai dal CAI durante l'uso del sito.
const { ErroApi, leggiScheda } = require('./sheets');
const { leggiDato } = require('./drive');
const { DATI } = require('./sincronizzazione');

function siAttivo(valore) {
  return String(valore || '').trim().toUpperCase().replace('Ì', 'I') === 'SI';
}

async function righeSettori() {
  try {
    return await leggiScheda('settori');
  } catch (errore) {
    if (errore instanceof ErroApi && errore.codice === 'errore_foglio') return []; // la scheda nasce con la prima sincronizzazione
    throw errore;
  }
}

// { aggiornato, settori: [{ id, codice, nome }], percorsi: [{ id, ref, nome, da, a, comuni, settori }], comuni: [nome] }
// Solo settori attivi, e solo percorsi che stanno in almeno uno di essi (con la sola lista dei loro settori attivi).
async function menuSentieri() {
  const [righe, dati] = await Promise.all([righeSettori(), leggiDato(DATI.percorsi)]);
  const settori = righe
    .filter((r) => r.id_osm2cai !== '' && siAttivo(r.attivo))
    .map((r) => ({ id: Number(r.id_osm2cai), codice: String(r.codice || ''), nome: String(r.nome || '').trim() }))
    .sort((a, b) => (a.nome || a.codice).localeCompare(b.nome || b.codice, 'it', { numeric: true }));
  const attivi = new Set(settori.map((s) => s.id));
  const percorsi = ((dati && dati.percorsi) || [])
    .map((p) => ({
      id: p.id, ref: p.ref || '', nome: p.nome || '', da: p.da || '', a: p.a || '',
      comuni: Array.isArray(p.comuni) ? p.comuni : [],
      settori: (p.settori || []).map(Number).filter((id) => attivi.has(id)),
    }))
    .filter((p) => p.settori.length > 0)
    .sort((a, b) => a.ref.localeCompare(b.ref, 'it', { numeric: true }) || a.id - b.id);
  const comuni = Array.from(new Set(percorsi.flatMap((p) => p.comuni))).sort((a, b) => a.localeCompare(b, 'it'));
  return { aggiornato: (dati && dati.aggiornato) || null, settori, percorsi, comuni };
}

// Tutti i percorsi sincronizzati (anche di settori oggi spenti), per ricavare i comuni di un invio. Copia in memoria per 5 minuti.
let copiaPercorsi = { quando: 0, dati: null };
async function tuttiIPercorsi() {
  if (copiaPercorsi.dati && Date.now() - copiaPercorsi.quando < 5 * 60 * 1000) return copiaPercorsi.dati;
  const dati = await leggiDato(DATI.percorsi);
  copiaPercorsi = { quando: Date.now(), dati: (dati && dati.percorsi) || [] };
  return copiaPercorsi.dati;
}

// Il percorso di un invio: dall'identificativo salvato (invii nuovi) oppure dal testo scritto allora («532 – Nome (Da → A)»),
// con il solo numero come ripiego se è unico. Restituisce null se non si riesce a capire.
function trovaPercorso(percorsi, invio) {
  const id = Number(invio.sentiero_id);
  if (invio.sentiero_id !== undefined && invio.sentiero_id !== '' && Number.isFinite(id)) {
    const trovato = percorsi.find((p) => p.id === id);
    if (trovato) return trovato;
  }
  const testo = String(invio.sentiero || '').trim();
  if (!testo) return null;
  const esatto = percorsi.find((p) => testoSentiero(p) === testo);
  if (esatto) return esatto;
  const ref = testo.split(/\s+/)[0];
  const candidati = percorsi.filter((p) => String(p.ref) === ref);
  return candidati.length === 1 ? candidati[0] : null;
}

const nomeSettore = (s) => (s.nome ? `${s.nome} (${s.codice})` : s.codice);

// Il nome che manda il CAI comincia già con il numero («900 - Torrente Ravone - Parco del Paleotto»): non si ripete.
function nomeSenzaNumero(p) {
  const nome = String(p.nome || '').trim();
  const ref = String(p.ref || '').trim();
  if (ref && nome.toLowerCase().startsWith(ref.toLowerCase())) {
    const dopo = nome.slice(ref.length);
    const resto = dopo.replace(/^\s*[-–—:]\s*/, '');
    if (resto !== dopo) return resto.trim();
  }
  return nome;
}

function testoSentiero(p) {
  const nome = nomeSenzaNumero(p);
  return [p.ref, nome ? '– ' + nome : '', p.da && p.a ? `(${p.da} → ${p.a})` : ''].filter(Boolean).join(' ');
}

module.exports = { menuSentieri, nomeSettore, testoSentiero, tuttiIPercorsi, trovaPercorso };
