// Tipi di problema (etichette) dalla scheda "etichette" del foglio: colonne etichetta, attiva (SI/NO), ordine.
// Gli admin le gestiscono dalla pagina «Categorie»; si possono anche modificare dal foglio.
// «Altro» è sempre disponibile in fondo al menu, non sta nel foglio e richiede una nota che spieghi il problema.
const { leggiScheda } = require('./sheets');

const ALTRO = 'Altro';
const MAX_NOME = 40;

function siAttivo(valore) {
  return String(valore || '').trim().toUpperCase().replace('Ì', 'I') === 'SI';
}

// Tutte le righe della scheda (anche disattivate), in ordine, con il numero di riga del foglio.
async function tutteLeEtichette() {
  const righe = await leggiScheda('etichette', { conRiga: true });
  return righe
    .filter((r) => r.etichetta)
    .map((r, posizione) => ({
      nome: r.etichetta,
      attiva: siAttivo(r.attiva),
      ordine: r.ordine !== '' && Number.isFinite(Number(r.ordine)) ? Number(r.ordine) : 1e6 + posizione,
      riga: r._riga,
    }))
    .sort((a, b) => a.ordine - b.ordine || a.nome.localeCompare(b.nome, 'it'));
}

// I nomi delle etichette attive, in ordine (senza «Altro»).
async function etichetteAttive() {
  return (await tutteLeEtichette()).filter((e) => e.attiva).map((e) => e.nome);
}

// Nome ripulito: spazi singoli, niente caratteri di controllo. Restituisce '' se non è utilizzabile.
function normalizzaNome(nome) {
  return String(nome || '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stessoNome(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

module.exports = { ALTRO, MAX_NOME, tutteLeEtichette, etichetteAttive, normalizzaNome, stessoNome };
