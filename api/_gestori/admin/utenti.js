// Utenti e ruoli   (solo super_admin)
//   GET  /api/admin/utenti -> { utenti: [{ email, nome, ruolo, attivo, creatoIl, ultimoAccesso, invii, foto }], ruoli, dominio }
//   POST /api/admin/utenti { azione: 'aggiungi', email, nome?, ruolo }
//   POST /api/admin/utenti { azione: 'modifica', email, ruolo?, attivo? } -> stessa risposta del GET dopo la modifica
// Gli utenti stanno nella scheda "utenti" del foglio (email, nome, ruolo, attivo, creato_il, ultimo_accesso). Non si cancellano:
// si disattivano (la disattivazione vale subito, il ruolo si rilegge dal foglio a ogni richiesta). Regole di sicurezza: solo
// indirizzi del dominio ammesso; nessuno cambia il ruolo o disattiva se stesso; resta sempre almeno un super_admin attivo.
const { RUOLI, RUOLI_SUPER, dominioAmmesso, protetto } = require('../../_lib/auth');
const { ErroApi, leggiScheda, aggiungiRighe, aggiornaCelle } = require('../../_lib/sheets');

const MAX_NOME = 80;
const EMAIL = /^[a-z0-9][a-z0-9._%+'-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

function siAttivo(valore) {
  return String(valore || '').trim().toUpperCase().replace('Ì', 'I') === 'SI';
}

function leggiCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (errore) {
    throw new ErroApi(400, 'richiesta_non_valida', 'corpo non valido');
  }
}

async function elenco() {
  const [righe, invii, foto] = await Promise.all([leggiScheda('utenti', { conRiga: true }), leggiScheda('invii'), leggiScheda('foto')]);
  const emailDiInvio = new Map(invii.map((i) => [i.id_invio, String(i.email_volontario || '').toLowerCase()]));
  const conteggi = new Map();
  const voce = (email) => { if (!conteggi.has(email)) conteggi.set(email, { invii: 0, foto: 0 }); return conteggi.get(email); };
  invii.forEach((i) => { voce(String(i.email_volontario || '').toLowerCase()).invii++; });
  foto.forEach((f) => { const e = emailDiInvio.get(f.id_invio); if (e) voce(e).foto++; });
  const utenti = righe.filter((r) => r.email).map((r) => {
    const email = r.email.toLowerCase();
    const c = conteggi.get(email) || { invii: 0, foto: 0 };
    return {
      email, nome: r.nome || '', ruolo: RUOLI.includes((r.ruolo || '').toLowerCase()) ? r.ruolo.toLowerCase() : '',
      attivo: siAttivo(r.attivo), creatoIl: r.creato_il || '', ultimoAccesso: r.ultimo_accesso || '', invii: c.invii, foto: c.foto, _riga: r._riga,
    };
  });
  utenti.sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'it'));
  return utenti;
}

function risposta(utenti) {
  return { utenti: utenti.map(({ _riga, ...resto }) => resto), ruoli: RUOLI, dominio: dominioAmmesso() };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_SUPER, async (richiesta, rispostaHttp, io) => {
    if (richiesta.method === 'POST') {
      const corpo = leggiCorpo(richiesta);
      const email = typeof corpo.email === 'string' ? corpo.email.trim().toLowerCase() : '';
      if (!EMAIL.test(email)) throw new ErroApi(400, 'email_non_valida');
      if (!email.endsWith('@' + dominioAmmesso())) throw new ErroApi(400, 'dominio_non_ammesso');
      const attuali = await elenco();
      const esistente = attuali.find((u) => u.email === email);

      if (corpo.azione === 'aggiungi') {
        if (!RUOLI.includes(corpo.ruolo)) throw new ErroApi(400, 'ruolo_non_valido');
        if (esistente) throw new ErroApi(409, 'utente_esistente');
        let nome = '';
        if (corpo.nome !== undefined && corpo.nome !== null && corpo.nome !== '') {
          if (typeof corpo.nome !== 'string') throw new ErroApi(400, 'richiesta_non_valida', 'nome non valido');
          nome = corpo.nome.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (nome.length > MAX_NOME) throw new ErroApi(400, 'nome_troppo_lungo');
        }
        await aggiungiRighe('utenti', [{ email, nome, ruolo: corpo.ruolo, attivo: 'SI', creato_il: new Date().toISOString() }]);
      } else if (corpo.azione === 'modifica') {
        if (!esistente) throw new ErroApi(404, 'utente_non_trovato');
        const valori = {};
        if (corpo.ruolo !== undefined) {
          if (!RUOLI.includes(corpo.ruolo)) throw new ErroApi(400, 'ruolo_non_valido');
          if (corpo.ruolo !== esistente.ruolo) valori.ruolo = corpo.ruolo;
        }
        if (corpo.attivo !== undefined) {
          if (typeof corpo.attivo !== 'boolean') throw new ErroApi(400, 'richiesta_non_valida', 'attivo non valido');
          if (corpo.attivo !== esistente.attivo) valori.attivo = corpo.attivo ? 'SI' : 'NO';
        }
        if (corpo.ruolo === undefined && corpo.attivo === undefined) throw new ErroApi(400, 'richiesta_non_valida', 'niente da modificare');
        if (Object.keys(valori).length) {
          if (email === io.email) throw new ErroApi(409, 'non_su_te_stesso'); // niente modifiche al proprio ruolo o stato: si resterebbe chiusi fuori
          const ruoloDopo = valori.ruolo || esistente.ruolo;
          const attivoDopo = valori.attivo ? valori.attivo === 'SI' : esistente.attivo;
          const restano = attuali.filter((u) => u.email !== email && u.ruolo === 'super_admin' && u.attivo).length + (ruoloDopo === 'super_admin' && attivoDopo ? 1 : 0);
          if (restano < 1) throw new ErroApi(409, 'ultimo_super_admin');
          await aggiornaCelle('utenti', [{ riga: esistente._riga, valori }]);
        }
      } else {
        throw new ErroApi(400, 'richiesta_non_valida', 'azione non valida');
      }
    }
    rispostaHttp.status(200).json(risposta(await elenco()));
  })(req, res);
};
