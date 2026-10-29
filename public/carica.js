// Vista "Carica foto" del volontario: scelta di foto e file ZIP, lettura della posizione,
// elenco con anteprime e avvisi. In questo passo NON invia ancora nulla: serve a controllare le foto.
// Richiede exif.js (CaiExif) e vendor/fflate.min.js (fflate).
(function () {
  'use strict';

  var ESTENSIONI = { jpg: 'image/jpeg', jpeg: 'image/jpeg', heic: 'image/heic', heif: 'image/heif' };
  var BLOCCO_ZIP = 4 * 1024 * 1024; // lettura dello ZIP a pezzi, per non caricarlo tutto in memoria
  var MAX_BYTE_ZIP = 1.5 * 1024 * 1024 * 1024; // oltre questo, meglio dividere in più invii
  var LARGHEZZA_ANTEPRIMA = 240;

  var MSG_SENZA_DATI = 'Questa foto non contiene più i dati dello scatto (posizione e data). ' +
    'Succede se è stata ricevuta da altri o inviata per email o con WhatsApp. ' +
    'Scaricala dal tuo Google Foto e caricala di nuovo.';
  var MSG_SENZA_POSIZIONE = 'Questa foto non ha la posizione. Può succedere se la localizzazione era spenta ' +
    'o se la foto è stata ricevuta da altri o inviata per email. Se puoi, scaricala dal tuo Google Foto.';
  var MSG_ILLEGGIBILE = 'Non riesco a leggere questo file: potrebbe essere danneggiato.';

  function estensione(nome) {
    var m = /\.([A-Za-z0-9]+)$/.exec(nome || '');
    return m ? m[1].toLowerCase() : '';
  }

  function nomeBase(percorso) {
    return String(percorso).split('/').pop();
  }

  function eZip(file) {
    return estensione(file.name) === 'zip' || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
  }

  // Dentro lo ZIP: solo foto, non cartelle, non file di servizio dei Mac.
  function fotoNelloZip(percorso) {
    if (/\/$/.test(percorso) || /(^|\/)__MACOSX\//.test(percorso)) return false;
    var base = nomeBase(percorso);
    return base.charAt(0) !== '.' && Object.prototype.hasOwnProperty.call(ESTENSIONI, estensione(base));
  }

  function nuovoUuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined) e.textContent = testo;
    return e;
  }

  function formatoData(iso) {
    if (!iso) return 'Data di scatto non disponibile';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'Data di scatto non disponibile';
    return 'Scattata il ' + d.toLocaleDateString('it-IT') + ' alle ' +
      d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  function formatoByte(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  // Estrae le foto da uno ZIP leggendolo a pezzi. Restituisce { foto: [{ nome, blob }], scartati }
  // (scartati = file dello ZIP che non sono foto, cartelle e file di servizio esclusi;
  // viste = tutte le voci trovate: se è 0 il file non è uno ZIP valido).
  // Lancia un errore se lo ZIP è danneggiato o troppo grande (mai in silenzio).
  function estraiZip(file, contatore) {
    return new Promise(function (risolvi, rifiuta) {
      var uz = new fflate.Unzip();
      uz.register(fflate.UnzipInflate);
      uz.register(fflate.UnzipPassThrough);
      var trovate = [];
      var scartati = 0;
      var viste = 0;
      var attive = 0;
      var finito = false;
      var chiuso = false;

      function chiudi(errore) {
        if (chiuso) return;
        chiuso = true;
        if (errore) rifiuta(errore); else risolvi({ foto: trovate, scartati: scartati, viste: viste });
      }
      function controlla() {
        if (finito && attive === 0) chiudi(null);
      }

      uz.onfile = function (voce) {
        viste++;
        var voluto = fotoNelloZip(voce.name);
        if (!voluto && !/\/$/.test(voce.name) && !/(^|\/)__MACOSX\//.test(voce.name) && nomeBase(voce.name).charAt(0) !== '.') scartati++;
        var pezzi = [];
        attive++;
        voce.ondata = function (errore, dati, ultimo) {
          if (errore) return chiudi(errore);
          if (voluto && dati && dati.length) {
            contatore.byte += dati.length;
            if (contatore.byte > MAX_BYTE_ZIP) return chiudi(new Error('troppo_grande'));
            pezzi.push(dati.slice());
          }
          if (ultimo) {
            attive--;
            if (voluto) trovate.push({ nome: nomeBase(voce.name), blob: new Blob(pezzi) });
            controlla();
          }
        };
        voce.start();
      };

      var posizione = 0;
      function avanti() {
        if (chiuso) return;
        if (file.size === 0) { finito = true; return controlla(); }
        file.slice(posizione, posizione + BLOCCO_ZIP).arrayBuffer().then(function (buf) {
          posizione += BLOCCO_ZIP;
          var ultimo = posizione >= file.size;
          try {
            uz.push(new Uint8Array(buf), ultimo);
          } catch (errore) {
            return chiudi(errore);
          }
          if (ultimo) { finito = true; controlla(); } else { avanti(); }
        }).catch(chiudi);
      }
      avanti();
    });
  }

  async function creaAnteprima(file) {
    try {
      var immagine = await createImageBitmap(file, { resizeWidth: LARGHEZZA_ANTEPRIMA, resizeQuality: 'medium' });
      var tela = document.createElement('canvas');
      tela.width = immagine.width;
      tela.height = immagine.height;
      tela.getContext('2d').drawImage(immagine, 0, 0);
      if (immagine.close) immagine.close();
      var blob = await new Promise(function (ok) { tela.toBlob(ok, 'image/jpeg', 0.7); });
      return blob ? URL.createObjectURL(blob) : null;
    } catch (errore) {
      return null; // il chiamante mostra "anteprima non disponibile": non è un errore del file
    }
  }

  function avvia(contenitore) {
    var elenco = []; // { chiave, nome, file, esito, anteprima }
    var ignorati = [];
    var chiavi = {};
    var inCorso = false; // lettura di foto e ZIP in corso
    var inviando = false; // invio in corso
    var idInvio = null;
    var dataModificata = false;
    var esitoInvio = null; // { inviate, nonInviate } dell'ultimo tentativo
    var etichette = []; // tipi di problema tra cui scegliere (dal foglio)
    var nomeAltro = ''; // la voce «Altro»: richiede una nota che spieghi il problema
    var etichetteCaricate = false;
    var etichetteNonDisponibili = false;

    contenitore.textContent = '';
    var scelta = el('label', 'scelta-file');
    var pulsante = el('span', 'pulsante-finto', 'Scegli foto o file ZIP');
    var campo = document.createElement('input');
    campo.type = 'file';
    campo.multiple = true;
    campo.accept = '.jpg,.jpeg,.heic,.heif,.zip,image/jpeg,image/heic,image/heif,application/zip';
    scelta.appendChild(pulsante);
    scelta.appendChild(campo);
    var aiuto = el('p', 'nota', 'Puoi scegliere più foto insieme, oppure il file ZIP scaricato da Google Foto. Prima di inviare, controlla l\'elenco qui sotto.');
    var stato = el('p', 'stato-lettura');
    stato.setAttribute('aria-live', 'polite');
    var riepilogo = el('div', 'riepilogo-foto');
    var lista = el('div', 'lista-foto');
    var dettagliIgnorati = el('details', 'ignorati');
    var svuota = el('button', 'secondario', 'Svuota l\'elenco');
    svuota.type = 'button';
    svuota.hidden = true;

    var pannelloInvio = el('div', 'pannello-invio');
    var etichettaData = el('label', 'campo-data');
    etichettaData.appendChild(el('span', null, 'Data del sopralluogo'));
    var campoData = document.createElement('input');
    campoData.type = 'date';
    etichettaData.appendChild(campoData);
    var etichettaTutte = el('label', 'campo-data');
    etichettaTutte.appendChild(el('span', null, 'Stesso problema per tutte le foto'));
    var sceltaTutte = document.createElement('select');
    etichettaTutte.appendChild(sceltaTutte);
    sceltaTutte.addEventListener('change', function () {
      var valore = sceltaTutte.value;
      sceltaTutte.value = '';
      if (!valore) return;
      daInviare().forEach(function (v) { v.etichetta = valore; });
      ridisegna();
    });
    var aiutoData = el('p', 'nota', 'È la data della prima foto: correggila se il sopralluogo è stato un altro giorno.');
    var pulsanteInvia = el('button', 'grande', 'Invia');
    pulsanteInvia.type = 'button';
    var avanzamento = el('p', 'stato-lettura');
    avanzamento.setAttribute('aria-live', 'polite');
    [etichettaTutte, etichettaData, aiutoData, pulsanteInvia, avanzamento].forEach(function (n) { pannelloInvio.appendChild(n); });

    [scelta, aiuto, stato, riepilogo, lista, pannelloInvio, dettagliIgnorati, svuota].forEach(function (n) { contenitore.appendChild(n); });

    function liberaAnteprima(voce) {
      if (voce.anteprima) URL.revokeObjectURL(voce.anteprima);
      voce.anteprima = null;
    }

    // Tipo di problema e nota di una foto (entrambi facoltativi). Si scrive direttamente sulla voce,
    // senza ridisegnare l'elenco, così non si perde il cursore mentre si scrive.
    function controlliDescrizione(voce) {
      var c = el('div', 'descrizione-foto');
      if (etichette.length) {
        var e = el('label', 'campo-descrizione');
        e.appendChild(el('span', null, 'Che problema c\'è?'));
        var sel = document.createElement('select');
        sel.appendChild(new Option('Nessuno in particolare', ''));
        etichette.forEach(function (nome) { sel.appendChild(new Option(nome, nome)); });
        sel.value = etichette.indexOf(voce.etichetta) !== -1 ? voce.etichetta : '';
        sel.disabled = inviando;
        sel.addEventListener('change', function () { voce.etichetta = sel.value; });
        e.appendChild(sel);
        c.appendChild(e);
      }
      var n = el('label', 'campo-descrizione');
      var titoloNota = el('span');
      n.appendChild(titoloNota);
      var campoNota = document.createElement('input');
      campoNota.type = 'text';
      campoNota.maxLength = 300;
      campoNota.value = voce.nota;
      campoNota.disabled = inviando;
      // Con «Altro» la nota è obbligatoria: il testo cambia subito, senza ridisegnare l'elenco.
      var aggiornaNota = function () {
        var obbligatoria = Boolean(nomeAltro) && voce.etichetta === nomeAltro;
        titoloNota.textContent = obbligatoria ? 'Spiega di che problema si tratta (obbligatorio)' : 'Nota (facoltativa)';
        campoNota.placeholder = obbligatoria ? 'Descrivi il problema in poche parole' : 'Per esempio: albero caduto dopo il ponte';
        campoNota.required = obbligatoria;
      };
      aggiornaNota();
      campoNota.addEventListener('input', function () { voce.nota = campoNota.value; });
      n.appendChild(campoNota);
      c.appendChild(n);
      if (etichette.length) {
        var sceltaFatta = c.querySelector('select');
        sceltaFatta.addEventListener('change', aggiornaNota);
      }
      return c;
    }

    function caricaEtichette() {
      if (etichetteCaricate || !window.CaiApi) return Promise.resolve();
      return window.CaiApi.chiedi('/api/etichette').then(function (r) {
        if (r.stato === 200 && r.corpo && Array.isArray(r.corpo.etichette)) {
          etichette = r.corpo.etichette;
          nomeAltro = r.corpo.altro || '';
          etichetteCaricate = true;
          etichetteNonDisponibili = false;
        } else {
          etichetteNonDisponibili = true;
        }
      }).catch(function () {
        etichetteNonDisponibili = true;
      });
    }

    function ridisegna() {
      var conPosizione = elenco.filter(function (v) { return v.esito.lat !== null; }).length;
      var illeggibili = elenco.filter(function (v) { return v.esito.errore; }).length;
      var senza = elenco.length - conPosizione - illeggibili;

      riepilogo.textContent = '';
      riepilogo.className = 'riepilogo-foto' + (elenco.length ? '' : ' vuoto');
      if (elenco.length) {
        riepilogo.appendChild(el('strong', null, elenco.length === 1 ? 'Hai scelto 1 foto.' : 'Hai scelto ' + elenco.length + ' foto.'));
        riepilogo.appendChild(el('div', null, '✅ Con posizione: ' + conPosizione));
        if (senza) riepilogo.appendChild(el('div', 'avviso-testo', '⚠️ Senza posizione: ' + senza));
        if (illeggibili) riepilogo.appendChild(el('div', 'avviso-testo', '❌ Non leggibili: ' + illeggibili));
        var inviate = elenco.filter(function (v) { return v.stato === 'inviata'; }).length;
        if (inviate) riepilogo.appendChild(el('div', null, '📤 Già inviate: ' + inviate));
        if (senza) {
          riepilogo.appendChild(el('div', 'nota', 'Le foto senza posizione si possono inviare lo stesso, ma gli amministratori le vedranno segnalate. Se puoi, ricaricale dal tuo Google Foto.'));
        }
        if (illeggibili) {
          riepilogo.appendChild(el('div', 'nota', 'Le foto non leggibili non vengono inviate.'));
        }
        if (etichetteNonDisponibili) {
          riepilogo.appendChild(el('div', 'nota', 'Non riesco a caricare l\'elenco dei tipi di problema: puoi inviare le foto lo stesso, con la sola nota.'));
        }
      }

      lista.textContent = '';
      elenco.forEach(function (voce) {
        var r = voce.esito;
        var classe = r.errore ? 'errore' : (r.lat !== null ? 'ok' : 'avviso');
        var scheda = el('div', 'foto ' + classe);
        if (voce.anteprima) {
          var img = el('img', 'anteprima');
          img.src = voce.anteprima;
          img.alt = '';
          scheda.appendChild(img);
        } else {
          scheda.appendChild(el('div', 'anteprima senza-immagine', r.formato === 'heic' ? 'Anteprima non disponibile (HEIC)' : 'Anteprima non disponibile'));
        }
        var dati = el('div', 'dati-foto');
        dati.appendChild(el('strong', 'nome-foto', voce.nome));
        dati.appendChild(el('div', 'nota', formatoData(r.dataScatto) + ' · ' + formatoByte(voce.file.size)));
        if (r.errore) {
          dati.appendChild(el('div', 'esito-foto', '❌ File non leggibile'));
          dati.appendChild(el('div', 'nota', MSG_ILLEGGIBILE));
        } else if (r.lat !== null) {
          dati.appendChild(el('div', 'esito-foto', '✅ Con posizione'));
        } else {
          dati.appendChild(el('div', 'esito-foto', '⚠️ Senza posizione'));
          dati.appendChild(el('div', 'nota', r.exif ? MSG_SENZA_POSIZIONE : MSG_SENZA_DATI));
        }
        if (voce.stato !== 'inviata' && !r.errore) dati.appendChild(controlliDescrizione(voce));
        voce.barra = null;
        voce.testoBarra = null;
        if (voce.stato === 'inviata') {
          dati.appendChild(el('div', 'esito-foto stato-inviata', '📤 Inviata'));
        } else if (voce.stato === 'in_invio') {
          voce.barra = document.createElement('progress');
          voce.barra.max = 1;
          voce.barra.value = voce.progresso;
          voce.testoBarra = el('div', 'nota', 'Invio in corso…');
          dati.appendChild(voce.barra);
          dati.appendChild(voce.testoBarra);
        } else if (voce.stato === 'caricata' && !voce.errore) {
          dati.appendChild(el('div', 'nota', 'Caricata su Drive, sto registrando…'));
        }
        if (voce.stato === 'inviata' && (voce.etichetta || voce.nota)) {
          dati.appendChild(el('div', 'nota', [voce.etichetta ? '🏷️ ' + voce.etichetta : '', voce.nota ? '💬 ' + voce.nota : ''].filter(Boolean).join(' · ')));
        }
        if (voce.errore) dati.appendChild(el('div', 'nota avviso-testo', voce.errore));
        if (!voce.idFileDrive && voce.stato !== 'in_invio' && !inviando) {
          var togli = el('button', 'secondario piccolo', 'Togli dall\'elenco');
          togli.type = 'button';
          togli.addEventListener('click', function () {
            var i = elenco.indexOf(voce);
            if (i !== -1) elenco.splice(i, 1);
            delete chiavi[voce.chiave];
            liberaAnteprima(voce);
            ridisegna();
          });
          dati.appendChild(togli);
        }
        scheda.appendChild(dati);
        lista.appendChild(scheda);
      });

      dettagliIgnorati.textContent = '';
      dettagliIgnorati.hidden = ignorati.length === 0;
      if (ignorati.length) {
        dettagliIgnorati.appendChild(el('summary', null, ignorati.length === 1 ? '1 file ignorato (non è una foto JPEG o HEIC)' : ignorati.length + ' file ignorati (non sono foto JPEG o HEIC)'));
        var ul = el('ul');
        ignorati.forEach(function (n) { ul.appendChild(el('li', null, n)); });
        dettagliIgnorati.appendChild(ul);
      }
      svuota.hidden = elenco.length === 0 && ignorati.length === 0;
      svuota.disabled = inviando;
      campo.disabled = inCorso || inviando;
      aggiornaPannelloInvio();
    }

    function leggibili() {
      return elenco.filter(function (v) { return !v.esito.errore; });
    }

    function daInviare() {
      return leggibili().filter(function (v) { return v.stato !== 'inviata'; });
    }

    // Data del sopralluogo: precompilata con il giorno della prima foto, finché non la cambia il volontario.
    function dataSuggerita() {
      var date = leggibili().map(function (v) { return (v.esito.dataScatto || '').slice(0, 10); })
        .filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
      return date[0] || '';
    }

    function aggiornaPannelloInvio() {
      var restanti = daInviare().length;
      var tutteInviate = leggibili().length > 0 && restanti === 0;
      pannelloInvio.hidden = leggibili().length === 0;
      etichettaData.hidden = aiutoData.hidden = tutteInviate;
      etichettaTutte.hidden = tutteInviate || restanti < 2 || etichette.length === 0;
      if (sceltaTutte.options.length !== etichette.length + 1) {
        sceltaTutte.textContent = '';
        sceltaTutte.appendChild(new Option('Scegli per applicarlo a tutte…', ''));
        etichette.forEach(function (nome) { sceltaTutte.appendChild(new Option(nome, nome)); });
      }
      sceltaTutte.disabled = inviando;
      pulsanteInvia.hidden = tutteInviate;
      if (!dataModificata && !inviando) campoData.value = dataSuggerita();
      campoData.disabled = inviando;
      pulsanteInvia.disabled = inviando || restanti === 0;
      pulsanteInvia.textContent = inviando ? 'Invio in corso…' : (esitoInvio && esitoInvio.nonInviate ? 'Riprova a inviare ' + restanti + (restanti === 1 ? ' foto' : ' foto') : 'Invia ' + restanti + (restanti === 1 ? ' foto' : ' foto'));
      avanzamento.className = 'stato-lettura';
      if (inviando) {
        var fatte = leggibili().filter(function (v) { return v.stato === 'inviata'; }).length;
        avanzamento.textContent = 'Non chiudere questa pagina finché non è finito. Inviate ' + fatte + ' di ' + leggibili().length + '.';
      } else if (tutteInviate) {
        avanzamento.className = 'stato-lettura stato-inviata';
        avanzamento.textContent = elenco.length === leggibili().length
          ? '✅ Fatto: tutte le foto sono state inviate. Grazie! Puoi svuotare l\'elenco e caricarne altre.'
          : '✅ Fatto: le foto leggibili sono state inviate. Grazie! Puoi svuotare l\'elenco e caricarne altre.';
      } else if (esitoInvio && esitoInvio.nonInviate) {
        avanzamento.className = 'stato-lettura errore-testo';
        avanzamento.textContent = esitoInvio.inviate + ' foto inviate, ' + esitoInvio.nonInviate + ' non inviate. Guarda i messaggi sotto ogni foto e riprova.';
      } else {
        avanzamento.textContent = '';
      }
    }

    // Aggiorna solo le barre di avanzamento (chiamato spesso durante il caricamento).
    var ultimoAggiornamento = 0;
    function aggiornaBarre() {
      var ora = Date.now();
      if (ora - ultimoAggiornamento < 150) return;
      ultimoAggiornamento = ora;
      elenco.forEach(function (v) {
        if (v.barra) v.barra.value = v.progresso;
        if (v.testoBarra) v.testoBarra.textContent = 'Invio in corso… ' + Math.round(v.progresso * 100) + '%';
      });
    }

    function avvisoUscita(evento) {
      evento.preventDefault();
      evento.returnValue = '';
    }

    async function inviaFoto() {
      if (inviando || inCorso) return;
      var voci = daInviare();
      if (!voci.length) return;
      // «Altro» senza nota: si ferma prima di inviare e si indicano le foto da completare.
      var senzaNota = voci.filter(function (v) { return nomeAltro && v.etichetta === nomeAltro && !v.nota.trim(); });
      if (senzaNota.length) {
        voci.forEach(function (v) { if (v.codiceErrore === 'nota_obbligatoria') { v.errore = null; v.codiceErrore = null; } });
        senzaNota.forEach(function (v) {
          v.errore = CaiInvio.messaggio('nota_obbligatoria');
          v.codiceErrore = 'nota_obbligatoria';
        });
        esitoInvio = null;
        ridisegna();
        avanzamento.className = 'stato-lettura errore-testo';
        avanzamento.textContent = senzaNota.length === 1
          ? 'Manca la spiegazione per 1 foto con «' + nomeAltro + '». Scrivila nella nota e premi di nuovo «Invia».'
          : 'Manca la spiegazione per ' + senzaNota.length + ' foto con «' + nomeAltro + '». Scrivila nelle note e premi di nuovo «Invia».';
        return;
      }
      voci.forEach(function (v) { if (v.codiceErrore === 'nota_obbligatoria') { v.errore = null; v.codiceErrore = null; } });
      if (!idInvio) idInvio = nuovoUuid();
      inviando = true;
      esitoInvio = null;
      window.addEventListener('beforeunload', avvisoUscita);
      ridisegna();
      try {
        esitoInvio = await CaiInvio.invia({
          voci: voci,
          idInvio: idInvio,
          dataSopralluogo: campoData.value,
          totaleFoto: leggibili().length,
          api: window.CaiApi.chiedi,
          aggiorna: function (leggero) { if (leggero) aggiornaBarre(); else ridisegna(); },
        });
      } catch (errore) {
        console.error('Invio interrotto:', errore);
        voci.forEach(function (v) { if (v.stato === 'in_invio') { v.stato = v.idFileDrive ? 'caricata' : 'errore'; v.errore = 'L\'invio si è interrotto. Premi «Invia» per riprovare.'; } });
        esitoInvio = { inviate: leggibili().filter(function (v) { return v.stato === 'inviata'; }).length, nonInviate: daInviare().length };
      } finally {
        inviando = false;
        window.removeEventListener('beforeunload', avvisoUscita);
        // Un tipo di problema tolto dal foglio nel frattempo: si ricarica l'elenco e si chiede di sceglierlo di nuovo.
        if (voci.some(function (v) { return v.codiceErrore === 'etichetta_non_valida'; })) {
          etichetteCaricate = false;
          await caricaEtichette();
          voci.forEach(function (v) { if (v.codiceErrore === 'etichetta_non_valida') v.etichetta = ''; });
        }
        ridisegna();
      }
    }

    async function aggiungiFoto(file, nome) {
      var chiave = nome + '|' + file.size;
      if (chiavi[chiave]) return false; // stessa foto già nell'elenco
      var esito = await CaiExif.leggi(file);
      if (esito.formato === 'altro' && !esito.errore) { ignorati.push(nome); return false; }
      chiavi[chiave] = true;
      var voce = {
        chiave: chiave, nome: nome, file: file, esito: esito, anteprima: null,
        idFoto: nuovoUuid(), tipo: ESTENSIONI[estensione(nome)],
        stato: 'da_inviare', progresso: 0, errore: null, codiceErrore: null, idFileDrive: null, barra: null, testoBarra: null,
        etichetta: '', nota: '',
      };
      elenco.push(voce);
      voce.anteprima = await creaAnteprima(file);
      return true;
    }

    async function aggiungi(fileScelti) {
      if (inCorso) return;
      inCorso = true;
      campo.disabled = true;
      await caricaEtichette(); // i tipi di problema si caricano alla prima scelta di foto
      var contatore = { byte: 0 };
      var files = Array.prototype.slice.call(fileScelti);
      try {
        for (var i = 0; i < files.length; i++) {
          var file = files[i];
          stato.textContent = 'Sto leggendo ' + (i + 1) + ' di ' + files.length + ': ' + file.name + '…';
          stato.className = 'stato-lettura';
          if (eZip(file)) {
            var dentro;
            try {
              dentro = await estraiZip(file, contatore);
            } catch (errore) {
              console.error('ZIP non aperto (' + file.name + '):', errore);
              stato.className = 'stato-lettura errore-testo';
              stato.textContent = errore && (errore.message === 'troppo_grande' || errore instanceof RangeError)
                ? 'Le foto contenute in «' + file.name + '» sono troppe per essere aperte in una volta. Dividile in più invii.'
                : 'Non riesco ad aprire «' + file.name + '»: il file ZIP sembra danneggiato.';
              continue;
            }
            if (dentro.viste === 0) {
              stato.className = 'stato-lettura errore-testo';
              stato.textContent = '«' + file.name + '» non sembra un file ZIP valido.';
              continue;
            }
            if (dentro.foto.length === 0) {
              ignorati.push(file.name + ' (nessuna foto nello ZIP)');
            } else if (dentro.scartati) {
              ignorati.push(file.name + ': ' + dentro.scartati + (dentro.scartati === 1 ? ' file che non è una foto' : ' file che non sono foto'));
            }
            for (var k = 0; k < dentro.foto.length; k++) {
              var interno = dentro.foto[k];
              var tipo = ESTENSIONI[estensione(interno.nome)];
              var f = new File([interno.blob], interno.nome, { type: tipo, lastModified: Date.now() });
              stato.textContent = 'Sto leggendo le foto di «' + file.name + '»: ' + (k + 1) + ' di ' + dentro.foto.length + '…';
              await aggiungiFoto(f, interno.nome);
              ridisegna();
            }
          } else if (Object.prototype.hasOwnProperty.call(ESTENSIONI, estensione(file.name))) {
            await aggiungiFoto(file, file.name);
          } else {
            ignorati.push(file.name);
          }
          ridisegna();
        }
        if (stato.className.indexOf('errore-testo') === -1) stato.textContent = '';
      } finally {
        inCorso = false;
        campo.disabled = false;
        ridisegna();
      }
    }

    campo.addEventListener('change', function () {
      var scelti = campo.files;
      aggiungi(scelti).then(function () { campo.value = ''; });
    });
    campoData.addEventListener('input', function () { dataModificata = true; });
    pulsanteInvia.addEventListener('click', inviaFoto);
    svuota.addEventListener('click', function () {
      if (inviando) return;
      elenco.forEach(liberaAnteprima);
      elenco = [];
      ignorati = [];
      chiavi = {};
      idInvio = null;
      dataModificata = false;
      esitoInvio = null;
      stato.textContent = '';
      ridisegna();
    });
    ridisegna();

    return {
      aggiungi: aggiungi,
      azzera: function () { svuota.click(); },
      elenco: function () { return elenco; },
      ignorati: function () { return ignorati; },
    };
  }

  window.Carica = { avvia: avvia };
})();
