// Invio delle foto: caricamento diretto su Drive (sessione creata dal server) e registrazione nel foglio.
// Le foto partono originali, senza ricompressione. Ogni foto ha il suo stato; un guasto su una foto
// non ferma le altre e si può riprovare solo quelle non inviate.
//
// Stati di una voce: 'da_inviare' | 'in_invio' | 'caricata' (su Drive, non ancora registrata) | 'inviata' | 'errore'
// Una voce è { idFoto, nome, file, tipo, stato, progresso (0..1), errore (testo o null), idFileDrive }.
(function () {
  'use strict';

  var FOTO_PER_SESSIONI = 50;
  var FOTO_PER_CONFERMA = 100;
  var CARICAMENTI_PARALLELI = 2;
  var TENTATIVI = 3;
  var TEMPO_MASSIMO_MS = 15 * 60 * 1000; // per una singola foto

  var MESSAGGI = {
    rete: 'La connessione si è interrotta. Controlla internet e riprova.',
    sessione_scaduta: 'La sessione è scaduta. Accedi di nuovo: le foto restano in elenco.',
    drive_pieno: 'Lo spazio su Drive del CAI è esaurito. Avvisa un amministratore.',
    drive_limite: 'Drive è molto occupato in questo momento. Aspetta qualche minuto e riprova.',
    drive_rifiutato: 'Drive ha rifiutato la foto. Riprova; se continua, avvisa un amministratore.',
    file_troppo_grande: 'Questa foto è troppo grande per essere inviata.',
    formato_non_ammesso: 'Possono essere inviate solo foto JPEG o HEIC.',
    file_non_trovato: 'La foto non è arrivata su Drive. Riprova a inviarla.',
    file_non_valido: 'La foto non è arrivata correttamente. Riprova a inviarla.',
    ruolo_non_ammesso: 'Il tuo account non può inviare foto.',
    non_abilitato: 'Il tuo account non è abilitato.',
    etichetta_non_valida: 'Il tipo di problema scelto non è più disponibile. Sceglilo di nuovo e riprova.',
    sentiero_non_valido: 'Il settore o il sentiero scelto non è più nel menu. Scegli di nuovo e riprova.',
    nota_obbligatoria: 'Con «Altro» scrivi nella nota di che problema si tratta.',
    caricata_non_registrata: 'La foto è su Drive ma non è ancora registrata. Premi «Invia» per riprovare.',
    generico: 'Il servizio ha avuto un problema. Riprova tra poco; se continua, avvisa un amministratore.',
  };

  function messaggio(codice) {
    return MESSAGGI[codice] || MESSAGGI.generico;
  }

  function pausa(ms) {
    return new Promise(function (risolvi) { setTimeout(risolvi, ms); });
  }

  function aBlocchi(elenco, dimensione) {
    var blocchi = [];
    for (var i = 0; i < elenco.length; i += dimensione) blocchi.push(elenco.slice(i, i + dimensione));
    return blocchi;
  }

  function erroreCon(codice, extra) {
    var e = new Error(codice);
    e.codice = codice;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  // Chiamata al server: restituisce il corpo oppure lancia un errore con un codice che sappiamo spiegare.
  async function chiamaServer(api, url, corpo) {
    var r;
    try {
      r = await api(url, { method: 'POST', body: corpo });
    } catch (errore) {
      throw erroreCon(errore && errore.message === 'sessione_scaduta' ? 'sessione_scaduta' : 'rete');
    }
    if (r.stato === 200 && r.corpo) return r.corpo;
    if (r.stato === 401) throw erroreCon('sessione_scaduta');
    throw erroreCon((r.corpo && r.corpo.errore) || 'generico');
  }

  async function creaSessioni(api, voci, idInvio) {
    var corpo = await chiamaServer(api, '/api/carica/avvia', {
      idInvio: idInvio,
      foto: voci.map(function (v) { return { idFoto: v.idFoto, nome: v.nome, dimensione: v.file.size, tipo: v.tipo }; }),
    });
    var indirizzi = {};
    (corpo.sessioni || []).forEach(function (s) { indirizzi[s.idFoto] = s.indirizzo; });
    return indirizzi;
  }

  // Invio vero e proprio di un file a Drive (una richiesta, con avanzamento).
  function caricaSuDrive(voce, indirizzo, aggiorna) {
    return new Promise(function (risolvi, rifiuta) {
      var x = new XMLHttpRequest();
      x.open('PUT', indirizzo);
      x.setRequestHeader('Content-Type', voce.tipo);
      x.timeout = TEMPO_MASSIMO_MS;
      x.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          voce.progresso = e.loaded / e.total;
          aggiorna(true); // solo l'avanzamento: non serve ridisegnare l'elenco
        }
      };
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          try {
            var corpo = JSON.parse(x.responseText);
            if (corpo && corpo.id) return risolvi(corpo);
          } catch (errore) { /* risposta non valida: vedi sotto */ }
          return rifiuta(erroreCon('drive_rifiutato', { stato: 502 }));
        }
        rifiuta(erroreCon(x.status === 403 ? 'drive_rifiutato' : 'errore_caricamento', { stato: x.status }));
      };
      x.onerror = function () { rifiuta(erroreCon('rete', { stato: 0 })); };
      x.ontimeout = function () { rifiuta(erroreCon('rete', { stato: 0 })); };
      x.send(voce.file);
    });
  }

  function segnaErrore(voce, codice, mantieniCaricata) {
    voce.codiceErrore = codice;
    voce.errore = messaggio(codice);
    voce.stato = mantieniCaricata ? 'caricata' : 'errore';
    voce.progresso = 0;
  }

  // Carica una foto, con qualche nuovo tentativo (da capo, con una sessione nuova) per i guasti passeggeri.
  async function caricaVoce(api, voce, idInvio, indirizzo, aggiorna) {
    for (var tentativo = 1; ; tentativo++) {
      try {
        voce.stato = 'in_invio';
        voce.progresso = 0;
        voce.errore = null;
        aggiorna();
        var risposta = await caricaSuDrive(voce, indirizzo, aggiorna);
        voce.idFileDrive = risposta.id;
        voce.stato = 'caricata';
        voce.progresso = 1;
        aggiorna();
        return;
      } catch (errore) {
        var stato = errore.stato;
        var passeggero = errore.codice === 'rete' || stato === 429 || stato >= 500 || stato === 404 || stato === 410;
        if (!passeggero || tentativo >= TENTATIVI) {
          segnaErrore(voce, errore.codice === 'rete' ? 'rete' : (errore.codice === 'drive_rifiutato' ? 'drive_rifiutato' : 'generico'));
          aggiorna();
          return;
        }
        await pausa(1000 * Math.pow(3, tentativo - 1));
        try {
          indirizzo = (await creaSessioni(api, [voce], idInvio))[voce.idFoto];
        } catch (e2) {
          segnaErrore(voce, e2.codice);
          aggiorna();
          return;
        }
      }
    }
  }

  async function conLimite(elementi, limite, azione) {
    var prossimo = 0;
    async function lavora() {
      while (prossimo < elementi.length) {
        var i = prossimo++;
        await azione(elementi[i]);
      }
    }
    var lavoratori = [];
    for (var k = 0; k < Math.min(limite, elementi.length); k++) lavoratori.push(lavora());
    await Promise.all(lavoratori);
  }

  async function confermaBlocco(api, blocco, o) {
    var corpo;
    try {
      corpo = await chiamaServer(api, '/api/carica/conferma', {
        idInvio: o.idInvio,
        dataSopralluogo: o.dataSopralluogo || '',
        settore: o.settore || null,
        sentiero: o.sentiero || null,
        totaleFoto: o.totaleFoto,
        foto: blocco.map(function (v) { return { idFoto: v.idFoto, idFileDrive: v.idFileDrive, etichetta: v.etichetta || '', nota: v.nota || '' }; }),
      });
    } catch (errore) {
      // La foto è già su Drive: si riprova solo la registrazione, senza ricaricarla.
      var codice = errore.codice === 'sessione_scaduta' || errore.codice === 'sentiero_non_valido' ? errore.codice : 'caricata_non_registrata';
      blocco.forEach(function (v) { segnaErrore(v, codice, true); });
      return;
    }
    var registrate = {};
    (corpo.registrate || []).forEach(function (id) { registrate[id] = true; });
    var errori = {};
    (corpo.errori || []).forEach(function (e) { errori[e.idFoto] = e.errore; });
    blocco.forEach(function (v) {
      if (registrate[v.idFoto]) {
        v.stato = 'inviata';
        v.progresso = 1;
        v.errore = null;
      } else if (errori[v.idFoto]) {
        if (errori[v.idFoto] === 'file_non_trovato' || errori[v.idFoto] === 'file_non_valido') v.idFileDrive = null; // da ricaricare
        segnaErrore(v, errori[v.idFoto]);
      } else {
        segnaErrore(v, 'caricata_non_registrata', true);
      }
    });
  }

  // opzioni: { voci, idInvio, dataSopralluogo, settore, sentiero, totaleFoto, api, aggiorna }
  async function invia(o) {
    var api = o.api;
    var aggiorna = o.aggiorna;
    var voci = o.voci.filter(function (v) { return v.stato !== 'inviata'; });
    voci.forEach(function (v) {
      if (v.idFileDrive) {
        v.stato = 'caricata'; // già su Drive: si riprova solo la registrazione
      } else if (v.stato !== 'caricata') {
        v.stato = 'in_invio';
        v.progresso = 0;
      }
      v.errore = null;
      v.codiceErrore = null;
    });
    aggiorna();

    // 1. Sessioni di caricamento per le foto che non sono ancora su Drive.
    var daCaricare = voci.filter(function (v) { return !v.idFileDrive; });
    var indirizzi = {};
    var bloccato = false;
    var codiceBloccante = 'generico';
    var blocchi = aBlocchi(daCaricare, FOTO_PER_SESSIONI);
    for (var b = 0; b < blocchi.length && !bloccato; b++) {
      try {
        var trovati = await creaSessioni(api, blocchi[b], o.idInvio);
        Object.keys(trovati).forEach(function (id) { indirizzi[id] = trovati[id]; });
      } catch (errore) {
        blocchi[b].forEach(function (v) { segnaErrore(v, errore.codice); });
        bloccato = errore.codice === 'sessione_scaduta' || errore.codice === 'drive_pieno' || errore.codice === 'drive_limite';
        if (bloccato) codiceBloccante = errore.codice;
      }
    }
    voci.forEach(function (v) {
      if (v.stato === 'in_invio' && !v.idFileDrive && !indirizzi[v.idFoto]) segnaErrore(v, codiceBloccante);
    });
    aggiorna();

    // 2. Caricamento dei file (due alla volta).
    var pronte = daCaricare.filter(function (v) { return indirizzi[v.idFoto] && v.stato === 'in_invio'; });
    await conLimite(pronte, CARICAMENTI_PARALLELI, function (v) {
      return caricaVoce(api, v, o.idInvio, indirizzi[v.idFoto], aggiorna);
    });

    // 3. Registrazione nel foglio di tutte le foto che sono su Drive.
    var daConfermare = voci.filter(function (v) { return v.stato === 'caricata' && v.idFileDrive; });
    var blocchiConferma = aBlocchi(daConfermare, FOTO_PER_CONFERMA);
    for (var c = 0; c < blocchiConferma.length; c++) {
      await confermaBlocco(api, blocchiConferma[c], o);
      aggiorna();
    }
    aggiorna();
    return {
      inviate: voci.filter(function (v) { return v.stato === 'inviata'; }).length,
      nonInviate: voci.filter(function (v) { return v.stato !== 'inviata'; }).length,
    };
  }

  window.CaiInvio = { invia: invia, messaggio: messaggio };
})();
