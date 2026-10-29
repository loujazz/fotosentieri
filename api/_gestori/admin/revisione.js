// POST /api/admin/revisione   (admin e super_admin)
// Corpo: { azione: 'approva' | 'rifiuta' | 'annulla', motivo?, foto: [idFoto] }   (da 1 a 100 foto)
// Approva: il file passa in "Approvate"; rifiuta (motivo obbligatorio): passa in "Scartate".
// Poi il foglio riceve stato, chi ha rivisto, quando e il motivo. Approva e rifiuta valgono per le foto "in_attesa".
// Annulla: una foto approvata o rifiutata torna "in_attesa" (il file torna in "Da approvare", chi ha rivisto, quando e il
// motivo si svuotano) e si può rivedere di nuovo.
// Risposta: { risultati: [{ idFoto, ok: true } | { idFoto, errore }] }
// Ripetibile: se il file è già stato spostato ma il foglio non si è aggiornato, un secondo tentativo completa il lavoro.
const { RUOLI_ADMIN, protetto } = require('../../_lib/auth');
const { ErroApi, variabile, leggiScheda, aggiornaCellePerId } = require('../../_lib/sheets');
const drive = require('../../_lib/drive');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FOTO = 100;
const MAX_MOTIVO = 500;

function richiestaNonValida(motivo) {
  return new ErroApi(400, 'richiesta_non_valida', motivo);
}

function leggiCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (errore) {
    throw richiestaNonValida('corpo non valido');
  }
}

async function conLimite(elementi, limite, azione) {
  let prossimo = 0;
  async function lavora() {
    while (prossimo < elementi.length) {
      const i = prossimo++;
      await azione(elementi[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, elementi.length) }, lavora));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta, utente) => {
    const corpo = leggiCorpo(richiesta);
    if (!['approva', 'rifiuta', 'annulla'].includes(corpo.azione)) throw richiestaNonValida('azione non valida');
    if (!Array.isArray(corpo.foto) || corpo.foto.length < 1 || corpo.foto.length > MAX_FOTO) throw new ErroApi(400, 'troppe_foto');
    if (!corpo.foto.every((id) => typeof id === 'string' && UUID.test(id))) throw richiestaNonValida('idFoto non valido');
    if (new Set(corpo.foto).size !== corpo.foto.length) throw richiestaNonValida('idFoto ripetuti');
    let motivo = '';
    if (corpo.azione === 'rifiuta') {
      motivo = typeof corpo.motivo === 'string' ? corpo.motivo.trim() : '';
      if (!motivo) throw new ErroApi(400, 'motivo_obbligatorio');
      if (motivo.length > MAX_MOTIVO) throw new ErroApi(400, 'motivo_troppo_lungo');
    }

    const approva = corpo.azione === 'approva';
    const annulla = corpo.azione === 'annulla';
    const cartellaArrivo = variabile(annulla ? 'FOLDER_DA_APPROVARE_ID' : (approva ? 'FOLDER_APPROVATE_ID' : 'FOLDER_SCARTATE_ID'));
    const righe = new Map((await leggiScheda('foto', { conRiga: true })).map((r) => [r.id_foto, r]));

    const risultati = new Map();
    const daAggiornare = [];
    await conLimite(corpo.foto, 3, async (idFoto) => {
      const riga = righe.get(idFoto);
      if (!riga) return risultati.set(idFoto, { idFoto, errore: 'foto_non_trovata' });
      if (annulla) {
        if (riga.stato !== 'approvata' && riga.stato !== 'rifiutata') return risultati.set(idFoto, { idFoto, errore: 'non_rivista' });
      } else if (riga.stato !== 'in_attesa') {
        return risultati.set(idFoto, { idFoto, errore: 'gia_rivista' });
      }
      try {
        await drive.sposta(riga.id_file_drive, cartellaArrivo);
      } catch (errore) {
        if (!(errore instanceof ErroApi)) throw errore;
        return risultati.set(idFoto, { idFoto, errore: errore.codice });
      }
      daAggiornare.push({ idFoto, riga: riga._riga });
    });

    if (daAggiornare.length) {
      const quando = new Date().toISOString();
      // Le righe si cercano per id al momento di scrivere: una foto eliminata nel frattempo non sposta le altre.
      const scomparse = await aggiornaCellePerId('foto', 'id_foto', daAggiornare.map((d) => ({
        id: d.idFoto,
        valori: annulla
          ? { stato: 'in_attesa', rivista_da: '', rivista_il: '', motivo_rifiuto: '' }
          : { stato: approva ? 'approvata' : 'rifiutata', rivista_da: utente.email, rivista_il: quando, motivo_rifiuto: motivo },
      })));
      daAggiornare.forEach((d) => risultati.set(d.idFoto, scomparse.includes(d.idFoto) ? { idFoto: d.idFoto, errore: 'foto_non_trovata' } : { idFoto: d.idFoto, ok: true }));
    }
    risposta.status(200).json({ risultati: corpo.foto.map((id) => risultati.get(id)) });
  })(req, res);
};
