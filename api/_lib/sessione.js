// Sessione propria del sito: dopo l'accesso con Google (ID token valido 1 ora) il server rilascia
// un "biglietto" firmato che dura 12 ore e si rinnova finché si usa il sito (al massimo 7 giorni
// dall'accesso con Google). Il biglietto contiene solo l'email: ruolo e abilitazione si leggono
// dal foglio a ogni richiesta, quindi una disattivazione vale subito.
const crypto = require('crypto');
const { ErroApi, variabile } = require('./sheets');

const PREFISSO = 'cai1.';
const DURATA_SECONDI = 12 * 60 * 60;
const VITA_MASSIMA_SECONDI = 7 * 24 * 60 * 60;

function segreto() {
  const valore = variabile('SESSION_SECRET');
  if (valore.length < 32) {
    throw new ErroApi(500, 'configurazione', 'SESSION_SECRET deve avere almeno 32 caratteri');
  }
  return valore;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function firma(parte) {
  return crypto.createHmac('sha256', segreto()).update(parte).digest();
}

function adesso() {
  return Math.floor(Date.now() / 1000);
}

function eBigliettoDiSessione(token) {
  return typeof token === 'string' && token.startsWith(PREFISSO);
}

// inizio = momento (in secondi) dell'accesso con Google da cui il biglietto discende.
function emetti(email, inizio) {
  const ora = adesso();
  const dati = { e: email, i: inizio || ora, x: ora + DURATA_SECONDI };
  const parte = PREFISSO + base64url(JSON.stringify(dati));
  return { token: parte + '.' + base64url(firma(parte)), scade: dati.x };
}

function verifica(token) {
  const pezzi = String(token).split('.');
  if (pezzi.length !== 3 || pezzi[0] + '.' !== PREFISSO) throw new ErroApi(401, 'token_non_valido');
  const parte = pezzi[0] + '.' + pezzi[1];
  const attesa = firma(parte);
  let ricevuta;
  try {
    ricevuta = Buffer.from(pezzi[2], 'base64url');
  } catch (errore) {
    throw new ErroApi(401, 'token_non_valido');
  }
  if (ricevuta.length !== attesa.length || !crypto.timingSafeEqual(ricevuta, attesa)) {
    throw new ErroApi(401, 'token_non_valido');
  }
  let dati;
  try {
    dati = JSON.parse(Buffer.from(pezzi[1], 'base64url').toString('utf8'));
  } catch (errore) {
    throw new ErroApi(401, 'token_non_valido');
  }
  if (!dati || typeof dati.e !== 'string' || !Number.isInteger(dati.i) || !Number.isInteger(dati.x)) {
    throw new ErroApi(401, 'token_non_valido');
  }
  if (dati.x <= adesso()) throw new ErroApi(401, 'token_scaduto');
  return { email: dati.e, inizio: dati.i, scade: dati.x };
}

// Un biglietto si può rinnovare solo se non è scaduto e l'accesso con Google non è troppo vecchio.
function rinnova(identita) {
  const ora = adesso();
  if (ora - identita.inizio > VITA_MASSIMA_SECONDI) throw new ErroApi(401, 'token_scaduto');
  return emetti(identita.email, identita.inizio);
}

module.exports = { eBigliettoDiSessione, emetti, verifica, rinnova };
