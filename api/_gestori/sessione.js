// POST /api/sessione
//  - con l'ID token di Google (accesso): rilascia il biglietto di sessione del sito (12 ore);
//  - con un biglietto di sessione ancora valido (rinnovo): ne rilascia uno nuovo.
// Risposta: { sessione, scade, email, nome, ruolo }
const { RUOLI, protetto } = require('../_lib/auth');
const sessione = require('../_lib/sessione');

const emetti = protetto(RUOLI, async (req, res, utente, identita) => {
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
