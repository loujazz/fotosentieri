// GET /api/admin/elenco   (admin e super_admin)
// Elenco in tabella di TUTTE le foto, filtrabile e ordinabile, a pagine. Solo consultazione: le azioni (approva, rifiuta, posizione,
// elimina) si fanno dalla scheda della foto, con le stesse funzioni della dashboard.
// Parametri (tutti facoltativi):
//   stato = in_attesa | approvata | rifiutata
//   comune = nome del comune, oppure "(non indicato)"           (il comune viene dal sentiero scelto dal volontario)
//   sentiero = chiave del sentiero (id:<numero> o testo:<testo>), oppure "(non indicato)"
//   problema = tipo di problema, oppure "(nessuno)"
//   volontario = email;  settore = chiave del settore (id:<numero> o testo:<testo>), oppure "(non indicato)"
//   tipoData = sopralluogo | scatto | invio | revisione (default sopralluogo), da = AAAA-MM-GG, a = AAAA-MM-GG
//   ordina = campo, verso = asc | desc, pagina (da 1), perPagina (25, 50 o 100)
// Risposta: { totale, pagina, pagine, perPagina, righe: [foto...], faccette: { comuni, sentieri, problemi, volontari, settori } }
// Le righe hanno la stessa forma di /api/admin/foto più comuni e chiavi di sentiero e settore.
const { RUOLI_ADMIN, protetto } = require('../../_lib/auth');
const { ErroApi, leggiScheda } = require('../../_lib/sheets');
const { costruisciFoto } = require('../../_lib/schedeFoto');
const { tuttiIPercorsi, trovaPercorso, testoSentiero } = require('../../_lib/sentieri');

const STATI = ['in_attesa', 'approvata', 'rifiutata'];
const NON_INDICATO = '(non indicato)';
const NESSUNO = '(nessuno)';
const TIPI_DATA = { sopralluogo: 'dataSopralluogo', scatto: 'dataScatto', invio: 'dataInvio', revisione: 'rivistaIl' };
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PER_PAGINA = [25, 50, 100];
const ORDINAMENTI = {
  dataSopralluogo: (r) => r.dataSopralluogo, dataScatto: (r) => r.dataScatto, dataInvio: (r) => r.dataInvio, rivistaIl: (r) => r.rivistaIl,
  volontario: (r) => r.volontario.nome || r.volontario.email, comune: (r) => r.comuni.join(', '), settore: (r) => r.settoreEtichetta,
  sentiero: (r) => r.sentieroEtichetta, problema: (r) => r.etichetta, stato: (r) => r.stato, nomeFile: (r) => r.nomeFile,
};

async function righeDelFoglio(nome) {
  try {
    return await leggiScheda(nome);
  } catch (errore) {
    if (errore instanceof ErroApi && errore.codice === 'errore_foglio' && nome === 'settori') return []; // la scheda nasce con la prima sincronizzazione
    throw errore;
  }
}

function parametro(parametri, nome, massimo) {
  const v = parametri.get(nome);
  if (v === null || v === '') return '';
  if (v.length > (massimo || 200)) throw new ErroApi(400, 'richiesta_non_valida', nome + ' troppo lungo');
  return v;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errore: 'metodo_non_ammesso' });
  }
  return protetto(RUOLI_ADMIN, async (richiesta, risposta) => {
    const q = new URL(richiesta.url, 'http://localhost').searchParams;
    const filtro = {
      stato: parametro(q, 'stato'), comune: parametro(q, 'comune'), sentiero: parametro(q, 'sentiero'), problema: parametro(q, 'problema'),
      volontario: parametro(q, 'volontario').toLowerCase(), settore: parametro(q, 'settore'),
    };
    if (filtro.stato && !STATI.includes(filtro.stato)) throw new ErroApi(400, 'richiesta_non_valida', 'stato non valido');
    const tipoData = parametro(q, 'tipoData') || 'sopralluogo';
    if (!TIPI_DATA[tipoData]) throw new ErroApi(400, 'richiesta_non_valida', 'tipoData non valido');
    const da = parametro(q, 'da');
    const a = parametro(q, 'a');
    if ((da && !DATA.test(da)) || (a && !DATA.test(a))) throw new ErroApi(400, 'richiesta_non_valida', 'data non valida');
    const ordina = parametro(q, 'ordina') || 'dataInvio';
    if (!ORDINAMENTI[ordina]) throw new ErroApi(400, 'richiesta_non_valida', 'ordinamento non valido');
    const verso = parametro(q, 'verso') === 'asc' ? 1 : -1;
    const perPagina = q.get('perPagina') ? Number(q.get('perPagina')) : 50;
    if (!PER_PAGINA.includes(perPagina)) throw new ErroApi(400, 'richiesta_non_valida', 'perPagina non valido');
    const paginaRichiesta = q.get('pagina') ? Number(q.get('pagina')) : 1;
    if (!Number.isInteger(paginaRichiesta) || paginaRichiesta < 1) throw new ErroApi(400, 'richiesta_non_valida', 'pagina non valida');

    const [foto, invii, percorsi, settoriFoglio] = await Promise.all([leggiScheda('foto'), leggiScheda('invii'), tuttiIPercorsi(), righeDelFoglio('settori')]);
    const nomeSettore = new Map(settoriFoglio.map((s) => [String(s.id_osm2cai), s.nome ? `${s.nome} (${s.codice})` : s.codice]));
    const perInvio = new Map(invii.map((i) => [i.id_invio, i]));

    // Comune, sentiero e settore si ricavano una volta sola per invio.
    const infoInvio = new Map();
    const info = (invio) => {
      if (!invio || !invio.id_invio) return { comuni: [], sentieroChiave: '', sentieroEtichetta: '', settoreChiave: '', settoreEtichetta: '' };
      if (!infoInvio.has(invio.id_invio)) {
        const p = trovaPercorso(percorsi, invio);
        const testoS = String(invio.sentiero || '').trim();
        const testoSet = String(invio.settore || '').trim();
        const idSet = invio.settore_id !== undefined && invio.settore_id !== '' ? String(invio.settore_id) : '';
        infoInvio.set(invio.id_invio, {
          comuni: p ? (p.comuni || []) : [],
          sentieroChiave: p ? 'id:' + p.id : (testoS ? 'testo:' + testoS : ''),
          sentieroEtichetta: p ? testoSentiero(p) : testoS,
          settoreChiave: idSet ? 'id:' + idSet : (testoSet ? 'testo:' + testoSet : ''),
          settoreEtichetta: idSet ? (nomeSettore.get(idSet) || testoSet || 'Settore ' + idSet) : testoSet,
        });
      }
      return infoInvio.get(invio.id_invio);
    };

    const tutte = foto.map((f) => {
      const invio = perInvio.get(f.id_invio);
      const i = info(invio);
      return Object.assign(costruisciFoto(f, invio), {
        comuni: i.comuni, sentieroChiave: i.sentieroChiave, sentieroEtichetta: i.sentieroEtichetta, settoreChiave: i.settoreChiave, settoreEtichetta: i.settoreEtichetta,
      });
    });

    // Elenchi per i menu dei filtri: tutto ciò che esiste (non solo il filtrato).
    const unici = (valori) => Array.from(new Set(valori.filter(Boolean)));
    const sentieriVisti = new Map();
    tutte.forEach((r) => { if (r.sentieroChiave && !sentieriVisti.has(r.sentieroChiave)) sentieriVisti.set(r.sentieroChiave, { chiave: r.sentieroChiave, etichetta: r.sentieroEtichetta, comuni: r.comuni }); });
    const settoriVisti = new Map();
    tutte.forEach((r) => { if (r.settoreChiave && !settoriVisti.has(r.settoreChiave)) settoriVisti.set(r.settoreChiave, { chiave: r.settoreChiave, etichetta: r.settoreEtichetta }); });
    const volontariVisti = new Map();
    tutte.forEach((r) => { const e = r.volontario.email.toLowerCase(); if (e && !volontariVisti.has(e)) volontariVisti.set(e, { email: e, nome: r.volontario.nome }); });
    const faccette = {
      comuni: unici(tutte.flatMap((r) => r.comuni)).sort((x, y) => x.localeCompare(y, 'it')),
      sentieri: Array.from(sentieriVisti.values()).sort((x, y) => x.etichetta.localeCompare(y.etichetta, 'it', { numeric: true })),
      problemi: unici(tutte.map((r) => r.etichetta)).sort((x, y) => x.localeCompare(y, 'it')),
      volontari: Array.from(volontariVisti.values()).sort((x, y) => (x.nome || x.email).localeCompare(y.nome || y.email, 'it')),
      settori: Array.from(settoriVisti.values()).sort((x, y) => x.etichetta.localeCompare(y.etichetta, 'it', { numeric: true })),
    };

    const campoData = TIPI_DATA[tipoData];
    const scelte = tutte.filter((r) => {
      if (filtro.stato && r.stato !== filtro.stato) return false;
      if (filtro.comune && (filtro.comune === NON_INDICATO ? r.comuni.length > 0 : !r.comuni.includes(filtro.comune))) return false;
      if (filtro.sentiero && (filtro.sentiero === NON_INDICATO ? r.sentieroChiave !== '' : r.sentieroChiave !== filtro.sentiero)) return false;
      if (filtro.problema && (filtro.problema === NESSUNO ? r.etichetta !== '' : r.etichetta !== filtro.problema)) return false;
      if (filtro.volontario && r.volontario.email.toLowerCase() !== filtro.volontario) return false;
      if (filtro.settore && (filtro.settore === NON_INDICATO ? r.settoreChiave !== '' : r.settoreChiave !== filtro.settore)) return false;
      if (da || a) {
        const giorno = String(r[campoData] || '').slice(0, 10);
        if (!DATA.test(giorno)) return false; // senza quella data, la riga non rientra in un intervallo
        if (da && giorno < da) return false;
        if (a && giorno > a) return false;
      }
      return true;
    });

    const chiave = ORDINAMENTI[ordina];
    scelte.sort((x, y) => verso * String(chiave(x) || '').localeCompare(String(chiave(y) || ''), 'it', { numeric: true }) ||
      (y.dataInvio || '').localeCompare(x.dataInvio || '') || (y.dataScatto || '').localeCompare(x.dataScatto || '') || x.nomeFile.localeCompare(y.nomeFile));

    const pagine = Math.max(1, Math.ceil(scelte.length / perPagina));
    const pagina = Math.min(paginaRichiesta, pagine);
    risposta.setHeader('Cache-Control', 'no-store');
    risposta.status(200).json({
      totale: scelte.length, tutte: tutte.length, pagina, pagine, perPagina, righe: scelte.slice((pagina - 1) * perPagina, pagina * perPagina), faccette,
    });
  })(req, res);
};
