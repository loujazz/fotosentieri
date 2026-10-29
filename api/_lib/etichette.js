// Elenco delle etichette (tipi di problema) dalla scheda "etichette" del foglio: solo quelle con attiva = SI,
// in ordine. Si modifica dal foglio, senza toccare il codice.
const { leggiScheda } = require('./sheets');

function siAttivo(valore) {
  return String(valore || '').trim().toUpperCase().replace('Ì', 'I') === 'SI';
}

async function etichetteAttive() {
  const righe = await leggiScheda('etichette');
  return righe
    .filter((r) => r.etichetta && siAttivo(r.attiva))
    .map((r, posizione) => ({ nome: r.etichetta, ordine: Number.isFinite(Number(r.ordine)) && r.ordine !== '' ? Number(r.ordine) : 1e6 + posizione }))
    .sort((a, b) => a.ordine - b.ordine || a.nome.localeCompare(b.nome, 'it'))
    .map((r) => r.nome);
}

module.exports = { etichetteAttive };
