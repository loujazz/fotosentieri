// Verifica dell'identità (ID token Google) e del ruolo (scheda "utenti" del foglio).
// Ogni funzione in api/ deve essere esportata tramite protetto(): il controllo
// dei permessi avviene sempre qui, sul server.
const { OAuth2Client } = require('google-auth-library');
const { ErroApi, variabile, leggiScheda } = require('./sheets');

const RUOLI = ['volontario', 'admin', 'super_admin'];
const RUOLI_ADMIN = ['admin', 'super_admin'];

const clientOAuth = new OAuth2Client();

function dominioAmmesso() {
  return variabile('ALLOWED_DOMAIN').toLowerCase().replace(/^@/, '');
}

// Verifica firma, scadenza e destinatario dell'ID token, poi il dominio.
async function verificaToken(req) {
  const intestazione = req.headers.authorization || '';
  const corrispondenza = intestazione.match(/^Bearer (.+)$/i);
  if (!corrispondenza) throw new ErroApi(401, 'token_mancante');

  let payload;
  try {
    const biglietto = await clientOAuth.verifyIdToken({
      idToken: corrispondenza[1],
      audience: variabile('GOOGLE_CLIENT_ID'),
    });
    payload = biglietto.getPayload();
  } catch (errore) {
    if (errore instanceof ErroApi) throw errore;
    throw new ErroApi(401, 'token_non_valido');
  }

  const dominio = dominioAmmesso();
  const email = String(payload.email || '').toLowerCase();
  if (!payload.email_verified || !email.endsWith('@' + dominio) || payload.hd !== dominio) {
    throw new ErroApi(403, 'dominio_non_ammesso');
  }
  return { email, nomeGoogle: payload.name || email };
}

function siAttivo(valore) {
  return String(valore || '').trim().toUpperCase().replace('Ì', 'I') === 'SI';
}

// Cerca l'utente nella scheda "utenti". Fallisce se non c'è, non è attivo
// o ha un ruolo non valido o non ammesso per la funzione richiesta.
async function utenteAbilitato(req, ruoliAmmessi) {
  const identita = await verificaToken(req);
  const utenti = await leggiScheda('utenti');
  const riga = utenti.find((u) => (u.email || '').toLowerCase() === identita.email);
  const ruolo = riga ? (riga.ruolo || '').toLowerCase() : '';
  if (!riga || !siAttivo(riga.attivo) || !RUOLI.includes(ruolo)) {
    throw new ErroApi(403, 'non_abilitato');
  }
  if (!ruoliAmmessi.includes(ruolo)) {
    throw new ErroApi(403, 'ruolo_non_ammesso');
  }
  return { email: identita.email, nome: riga.nome || identita.nomeGoogle, ruolo };
}

// Avvolge una funzione: controlla il ruolo e trasforma gli errori in risposte JSON.
// Gli errori imprevisti si registrano nei log e non si mostrano all'utente.
function protetto(ruoliAmmessi, gestore) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const utente = await utenteAbilitato(req, ruoliAmmessi);
      await gestore(req, res, utente);
    } catch (errore) {
      risposta(res, errore);
    }
  };
}

function risposta(res, errore) {
  if (errore instanceof ErroApi) {
    if (errore.stato >= 500) console.error(errore.codice, errore.message);
    return res.status(errore.stato).json({ errore: errore.codice });
  }
  console.error('Errore imprevisto:', errore);
  return res.status(500).json({ errore: 'errore_server' });
}

module.exports = { RUOLI, RUOLI_ADMIN, dominioAmmesso, protetto, risposta };
