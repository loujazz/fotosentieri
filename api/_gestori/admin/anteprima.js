// GET /api/admin/anteprima?id=<idFoto>&misura=piccola|grande   (admin e super_admin)
// Miniatura della foto, letta da Drive con l'account di servizio e restituita solo dopo il controllo
// del ruolo. L'indirizzo del file su Drive si legge dal foglio, mai dalla richiesta.
const { RUOLI_ADMIN, protetto } = require('../../_lib/auth');
const { ErroApi, leggiScheda } = require('../../_lib/sheets');
const drive = require('../../_lib/drive');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISURE = { piccola: 400, grande: 1600 };

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta) => {
    const parametri = new URL(richiesta.url, 'http://localhost').searchParams;
    const id = parametri.get('id') || '';
    const misura = MISURE[parametri.get('misura') || 'piccola'];
    if (!UUID.test(id) || !misura) throw new ErroApi(400, 'richiesta_non_valida');

    const riga = (await leggiScheda('foto')).find((f) => f.id_foto === id);
    if (!riga || !riga.id_file_drive) throw new ErroApi(404, 'foto_non_trovata');
    const { dati, tipo } = await drive.miniatura(riga.id_file_drive, misura);

    risposta.setHeader('Content-Type', tipo);
    risposta.setHeader('Cache-Control', 'private, max-age=3600');
    risposta.status(200).send(dati);
  })(req, res);
};
