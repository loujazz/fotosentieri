// Una foto del foglio (riga di "foto" + riga del suo invio) nella forma che le pagine degli admin si aspettano.
// Usata dall'elenco a schede (api/admin/foto) e dall'elenco in tabella (api/admin/elenco).
function numero(valore) {
  if (valore === '' || valore === undefined || valore === null) return null;
  const n = Number(String(valore).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function costruisciFoto(f, invio) {
  const i = invio || {};
  return {
    idFoto: f.id_foto,
    nomeFile: f.nome_file,
    lat: numero(f.latitudine),
    lon: numero(f.longitudine),
    fontePosizione: f.fonte_posizione,
    dataScatto: f.data_scatto,
    stato: f.stato,
    rivistaDa: f.rivista_da,
    rivistaIl: f.rivista_il,
    motivoRifiuto: f.motivo_rifiuto,
    volontario: { nome: i.nome_volontario || '', email: i.email_volontario || '' },
    etichetta: f.etichetta || '',
    nota: f.nota || '',
    settore: i.settore || '',
    sentiero: i.sentiero || '',
    dataSopralluogo: i.data_sopralluogo || '',
    dataInvio: i.data_invio || '',
  };
}

module.exports = { numero, costruisciFoto };
