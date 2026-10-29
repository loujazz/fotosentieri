// POST /api/sessione
//  - con l'ID token di Google (accesso): rilascia il biglietto di sessione del sito (12 ore);
//  - con un biglietto di sessione ancora valido (rinnovo): ne rilascia uno nuovo.
// Risposta: { sessione, scade, email, nome, ruolo }
const { RUOLI, protetto } = require('../_lib/auth');
const sessione = require('../_lib/sessione');
const { aggiornaCelle, assicuraColonna } = require('../_lib/sheets');

const INTERVALLO_ACCESSO_MS = 60 * 60 * 1000; // l'ultimo accesso si riscrive al massimo una volta all'ora

// Annota nella scheda "utenti" quando l'utente è entrato con Google. Se non riesce, l'accesso non si ferma: si registra
// l'errore nei log (l'ultimo accesso è solo un'informazione per il super admin).
async function registraAccesso(utente) {
  try {
    const ultimo = Date.parse(utente._ultimoAccesso);
    if (Number.isFinite(ultimo) && Date.now() - ultimo < INTERVALLO_ACCESSO_MS) return;
    await assicuraColonna('utenti', 'ultimo_accesso');
    await aggiornaCelle('utenti', [{ riga: utente._riga, valori: { ultimo_accesso: new Date().toISOString() } }]);
  } catch (errore) {
    console.error('Ultimo accesso non registrato:', errore && errore.message);
  }
}

const emetti = protetto(RUOLI, async (req, res, utente, identita) => {
  if (identita.origine === 'google') await registraAccesso(utente);
  const nuovo = identita.origine === 'google' ? sessione.emetti(utente.email) : sessione.rinnova(identita);
  res.status(200).json({ sessione: nuovo.token, scade: nuovo.scade, email: utente.email, nome: utente.nome, ruolo: utente.ruolo });
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return emetti(req, res);
};
