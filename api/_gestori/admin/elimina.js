// POST /api/admin/elimina   (solo super_admin)
// Corpo: { foto: [idFoto] }   (da 1 a 100 foto)
// Elimina DEFINITIVAMENTE le foto: il file sparisce da Drive (non va nel cestino) e la riga sparisce dal foglio. Se di un
// invio non resta nessuna foto, sparisce anche la riga dell'invio. Non si può annullare.
// Se l'account di servizio non è «Gestore» del Drive condiviso, Drive non permette l'eliminazione definitiva: il file va nel
// cestino di Drive (si svuota da solo dopo 30 giorni) e il risultato porta cestino: true.
// Risposta: { risultati: [{ idFoto, ok: true, cestino? } | { idFoto, errore }] }
// Ripetibile: se il file è già stato eliminato ma la riga è rimasta (guasto a metà), un secondo tentativo completa il lavoro.
const { RUOLI_SUPER, protetto } = require('../../_lib/auth');
const { ErroApi, variabile, leggiScheda, eliminaRighe } = require('../../_lib/sheets');
const drive = require('../../_lib/drive');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FOTO = 100;

function leggiCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (errore) {
    throw new ErroApi(400, 'richiesta_non_valida', 'corpo non valido');
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
  return protetto(RUOLI_SUPER, async (richiesta, risposta, utente) => {
    const corpo = leggiCorpo(richiesta);
    if (!Array.isArray(corpo.foto) || corpo.foto.length < 1 || corpo.foto.length > MAX_FOTO) throw new ErroApi(400, 'troppe_foto');
    if (!corpo.foto.every((id) => typeof id === 'string' && UUID.test(id))) throw new ErroApi(400, 'richiesta_non_valida', 'idFoto non valido');
    if (new Set(corpo.foto).size !== corpo.foto.length) throw new ErroApi(400, 'richiesta_non_valida', 'idFoto ripetuti');

    const cartelle = ['FOLDER_DA_APPROVARE_ID', 'FOLDER_APPROVATE_ID', 'FOLDER_SCARTATE_ID'].map(variabile);
    const righe = new Map((await leggiScheda('foto')).map((r) => [r.id_foto, r]));
    const risultati = new Map();
    const daCancellare = [];
    const nelCestino = new Set();

    // 1. Il file su Drive (prima: se Drive fallisce, la riga resta e si può riprovare).
    await conLimite(corpo.foto, 3, async (idFoto) => {
      const riga = righe.get(idFoto);
      if (!riga) return risultati.set(idFoto, { idFoto, errore: 'foto_non_trovata' });
      try {
        if ((await drive.elimina(riga.id_file_drive, cartelle)) === 'cestino') nelCestino.add(idFoto);
      } catch (errore) {
        if (!(errore instanceof ErroApi)) throw errore;
        return risultati.set(idFoto, { idFoto, errore: errore.codice });
      }
      daCancellare.push(idFoto);
    });

    // 2. Le righe nel foglio: prima le foto, poi gli invii rimasti senza foto.
    if (daCancellare.length) {
      try {
        await eliminaRighe('foto', 'id_foto', daCancellare);
        const rimaste = new Set((await leggiScheda('foto')).map((r) => r.id_invio));
        const invii = Array.from(new Set(daCancellare.map((id) => righe.get(id).id_invio))).filter((id) => id && !rimaste.has(id));
        if (invii.length) await eliminaRighe('invii', 'id_invio', invii);
        daCancellare.forEach((id) => risultati.set(id, nelCestino.has(id) ? { idFoto: id, ok: true, cestino: true } : { idFoto: id, ok: true }));
        console.log(`Eliminazione definitiva: ${daCancellare.length} foto eliminate da ${utente.email}`);
      } catch (errore) {
        if (!(errore instanceof ErroApi)) throw errore;
        daCancellare.forEach((id) => risultati.set(id, { idFoto: id, errore: errore.codice })); // il file non c'è più: riprovare completa il lavoro
      }
    }
    risposta.status(200).json({ risultati: corpo.foto.map((id) => risultati.get(id)) });
  })(req, res);
};
