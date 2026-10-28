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
    var inCorso = false;

    contenitore.textContent = '';
    var scelta = el('label', 'scelta-file');
    var pulsante = el('span', 'pulsante-finto', 'Scegli foto o file ZIP');
    var campo = document.createElement('input');
    campo.type = 'file';
    campo.multiple = true;
    campo.accept = '.jpg,.jpeg,.heic,.heif,.zip,image/jpeg,image/heic,image/heif,application/zip';
    scelta.appendChild(pulsante);
    scelta.appendChild(campo);
    var aiuto = el('p', 'nota', 'Puoi scegliere più foto insieme, oppure il file ZIP scaricato da Google Foto. Le foto non vengono inviate: per ora vengono solo controllate.');
    var stato = el('p', 'stato-lettura');
    stato.setAttribute('aria-live', 'polite');
    var riepilogo = el('div', 'riepilogo-foto');
    var lista = el('div', 'lista-foto');
    var dettagliIgnorati = el('details', 'ignorati');
    var svuota = el('button', 'secondario', 'Svuota l\'elenco');
    svuota.type = 'button';
    svuota.hidden = true;
    [scelta, aiuto, stato, riepilogo, lista, dettagliIgnorati, svuota].forEach(function (n) { contenitore.appendChild(n); });

    function liberaAnteprima(voce) {
      if (voce.anteprima) URL.revokeObjectURL(voce.anteprima);
      voce.anteprima = null;
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
        if (senza || illeggibili) {
          riepilogo.appendChild(el('div', 'nota', 'Le foto senza posizione si possono inviare lo stesso, ma gli amministratori le vedranno segnalate. Se puoi, ricaricale dal tuo Google Foto.'));
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
    }

    async function aggiungiFoto(file, nome) {
      var chiave = nome + '|' + file.size;
      if (chiavi[chiave]) return false; // stessa foto già nell'elenco
      var esito = await CaiExif.leggi(file);
      if (esito.formato === 'altro' && !esito.errore) { ignorati.push(nome); return false; }
      chiavi[chiave] = true;
      var voce = { chiave: chiave, nome: nome, file: file, esito: esito, anteprima: null };
      elenco.push(voce);
      voce.anteprima = await creaAnteprima(file);
      return true;
    }

    async function aggiungi(fileScelti) {
      if (inCorso) return;
      inCorso = true;
      campo.disabled = true;
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
    svuota.addEventListener('click', function () {
      elenco.forEach(liberaAnteprima);
      elenco = [];
      ignorati = [];
      chiavi = {};
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
