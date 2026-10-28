// Dashboard degli amministratori: elenco delle foto con miniatura, autore e posizione;
// approvazione e rifiuto (anche di più foto insieme). I permessi si controllano sul server:
// questa pagina mostra solo quello che le funzioni api/admin/* restituiscono.
(function () {
  'use strict';

  var SCHEDE = [
    { id: 'in_attesa', titolo: 'Da approvare' },
    { id: 'approvata', titolo: 'Approvate' },
    { id: 'rifiutata', titolo: 'Rifiutate' },
  ];
  var MINIATURE_CONTEMPORANEE = 4;

  var MESSAGGI = {
    foto_non_trovata: 'Questa foto non è più nell\'elenco.',
    gia_rivista: 'Questa foto è già stata rivista da qualcun altro.',
    drive_non_trovato: 'La foto non si trova più su Drive.',
    drive_limite: 'Drive è molto occupato: aspetta qualche minuto e riprova.',
    drive_pieno: 'Lo spazio su Drive è esaurito.',
    motivo_obbligatorio: 'Scrivi il motivo del rifiuto.',
    motivo_troppo_lungo: 'Il motivo è troppo lungo (al massimo 500 caratteri).',
    rete: 'Connessione interrotta. Controlla internet e riprova.',
    sessione_scaduta: 'La sessione è scaduta: accedi di nuovo.',
    generico: 'Il servizio ha avuto un problema. Riprova tra poco.',
  };

  function messaggio(codice) {
    return MESSAGGI[codice] || MESSAGGI.generico;
  }

  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined) e.textContent = testo;
    return e;
  }

  function pulsante(testo, classe, azione) {
    var b = el('button', classe, testo);
    b.type = 'button';
    b.addEventListener('click', azione);
    return b;
  }

  function dataOra(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('it-IT') + ' alle ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  function soloData(testo) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(testo || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('it-IT') : '';
  }

  function senzaPosizione(f) {
    return f.lat === null || f.lon === null;
  }

  function avvia(contenitore) {
    var stato = 'in_attesa';
    var soloSenza = false;
    var ultimo = null; // ultima risposta di /api/admin/foto
    var selezione = {}; // idFoto -> true
    var miniature = {}; // idFoto -> indirizzo dell'immagine (oggetto del browser)
    var coda = [];
    var attive = 0;
    var generazione = 0; // cambia a ogni ridisegno: le miniature in ritardo di un elenco vecchio si scartano
    var modaleAperta = null;
    var osservatore = null;

    contenitore.textContent = '';
    var schede = el('div', 'schede-stato');
    var filtro = el('label', 'filtro-posizione');
    var casella = document.createElement('input');
    casella.type = 'checkbox';
    filtro.appendChild(casella);
    filtro.appendChild(el('span', null, ' Mostra solo le foto senza posizione'));
    var barra = el('div', 'barra-selezione');
    var avviso = el('p', 'stato-lettura');
    avviso.setAttribute('aria-live', 'polite');
    var griglia = el('div', 'griglia-foto');
    [schede, filtro, barra, avviso, griglia].forEach(function (n) { contenitore.appendChild(n); });

    // ---- finestre di dialogo ----
    function chiudiModale() {
      if (!modaleAperta) return;
      document.removeEventListener('keydown', modaleAperta.tasti);
      modaleAperta.sfondo.remove();
      modaleAperta = null;
    }

    function apriModale(contenuto, opzioni) {
      chiudiModale();
      var sfondo = el('div', 'modale-sfondo');
      var finestra = el('div', 'modale' + (opzioni && opzioni.larga ? ' larga' : ''));
      finestra.setAttribute('role', 'dialog');
      finestra.setAttribute('aria-modal', 'true');
      finestra.appendChild(contenuto);
      sfondo.appendChild(finestra);
      sfondo.addEventListener('click', function (e) { if (e.target === sfondo) chiudiModale(); });
      var tasti = function (e) { if (e.key === 'Escape') chiudiModale(); };
      document.addEventListener('keydown', tasti);
      document.body.appendChild(sfondo);
      modaleAperta = { sfondo: sfondo, tasti: tasti };
    }

    // Domanda di conferma. Con "chiediMotivo" il motivo è obbligatorio. Risolve con { motivo } oppure null.
    function chiediConferma(titolo, testi, etichettaSi, chiediMotivo) {
      return new Promise(function (risolvi) {
        var c = el('div');
        c.appendChild(el('h3', null, titolo));
        testi.forEach(function (t) { c.appendChild(el('p', t.avviso ? 'avviso-testo' : 'messaggio', t.testo)); });
        var campo = null;
        var errore = el('p', 'avviso-testo');
        if (chiediMotivo) {
          c.appendChild(el('label', 'etichetta-motivo', 'Motivo del rifiuto (obbligatorio)'));
          campo = document.createElement('textarea');
          campo.rows = 3;
          campo.maxLength = 500;
          c.appendChild(campo);
          c.appendChild(errore);
        }
        var azioni = el('div', 'azioni-modale');
        azioni.appendChild(pulsante('Annulla', 'secondario', function () { chiudiModale(); risolvi(null); }));
        azioni.appendChild(pulsante(etichettaSi, chiediMotivo ? 'pericolo' : '', function () {
          var motivo = campo ? campo.value.trim() : '';
          if (chiediMotivo && !motivo) { errore.textContent = 'Scrivi il motivo del rifiuto.'; campo.focus(); return; }
          chiudiModale();
          risolvi({ motivo: motivo });
        }));
        c.appendChild(azioni);
        apriModale(c);
        if (campo) campo.focus();
      });
    }

    function mostraEsito(titolo, righe) {
      var c = el('div');
      c.appendChild(el('h3', null, titolo));
      righe.forEach(function (r) { c.appendChild(el('p', r.avviso ? 'avviso-testo' : 'messaggio', r.testo)); });
      c.appendChild(el('div', 'azioni-modale')).appendChild(pulsante('Chiudi', '', chiudiModale));
      apriModale(c);
    }

    // ---- miniature (poche alla volta, solo quelle visibili) ----
    function impostaMiniatura(contenitoreMiniatura, indirizzo) {
      contenitoreMiniatura.textContent = '';
      var img = el('img', 'miniatura-img');
      img.src = indirizzo;
      img.alt = '';
      contenitoreMiniatura.appendChild(img);
    }

    function prossimaMiniatura() {
      while (attive < MINIATURE_CONTEMPORANEE && coda.length) {
        var lavoro = coda.shift();
        attive++;
        (function (l) {
          window.CaiApi.blob('/api/admin/anteprima?id=' + encodeURIComponent(l.idFoto) + '&misura=piccola').then(function (blob) {
            var indirizzo = URL.createObjectURL(blob);
            if (l.generazione !== generazione) { URL.revokeObjectURL(indirizzo); return; }
            miniature[l.idFoto] = indirizzo;
            impostaMiniatura(l.elemento, indirizzo);
          }).catch(function () {
            if (l.generazione === generazione) l.elemento.textContent = 'Anteprima non disponibile';
          }).then(function () {
            attive--;
            prossimaMiniatura();
          });
        })(lavoro);
      }
    }

    function richiediMiniatura(idFoto, elemento) {
      if (miniature[idFoto]) return impostaMiniatura(elemento, miniature[idFoto]);
      coda.push({ idFoto: idFoto, elemento: elemento, generazione: generazione });
      prossimaMiniatura();
    }

    function osservaMiniatura(idFoto, elemento) {
      if (!('IntersectionObserver' in window)) return richiediMiniatura(idFoto, elemento);
      if (!osservatore) {
        osservatore = new IntersectionObserver(function (voci) {
          voci.forEach(function (v) {
            if (!v.isIntersecting) return;
            osservatore.unobserve(v.target);
            richiediMiniatura(v.target.getAttribute('data-id'), v.target);
          });
        }, { rootMargin: '200px' });
      }
      elemento.setAttribute('data-id', idFoto);
      osservatore.observe(elemento);
    }

    // ---- foto intera ----
    function apriGrande(f) {
      var c = el('div');
      c.appendChild(el('h3', 'nome-foto', f.nomeFile));
      var area = el('div', 'foto-grande', 'Sto caricando la foto…');
      c.appendChild(area);
      c.appendChild(el('p', 'nota', senzaPosizione(f) ? '⚠️ Senza posizione' : '📍 ' + f.lat.toFixed(6) + ', ' + f.lon.toFixed(6)));
      c.appendChild(el('div', 'azioni-modale')).appendChild(pulsante('Chiudi', '', chiudiModale));
      apriModale(c, { larga: true });
      window.CaiApi.blob('/api/admin/anteprima?id=' + encodeURIComponent(f.idFoto) + '&misura=grande').then(function (blob) {
        var indirizzo = URL.createObjectURL(blob);
        var img = el('img', 'foto-grande-img');
        img.alt = f.nomeFile;
        img.onload = function () { URL.revokeObjectURL(indirizzo); };
        img.src = indirizzo;
        area.textContent = '';
        area.appendChild(img);
      }).catch(function () {
        area.textContent = 'Anteprima non disponibile per questa foto.';
      });
    }

    // ---- azioni ----
    async function revisiona(azione, ids) {
      var f = ultimo.foto.filter(function (x) { return ids.indexOf(x.idFoto) !== -1; });
      var senza = f.filter(senzaPosizione).length;
      var approva = azione === 'approva';
      var quante = ids.length === 1 ? '1 foto' : ids.length + ' foto';
      var testi = [{ testo: approva ? 'Le foto passeranno tra quelle approvate.' : 'Le foto saranno messe da parte come scartate e il motivo resterà registrato.' }];
      if (approva && senza) {
        testi.push({ avviso: true, testo: senza === 1 ? '⚠️ 1 di queste foto non ha la posizione: non comparirà sulla mappa.' : '⚠️ ' + senza + ' di queste foto non hanno la posizione: non compariranno sulla mappa.' });
      }
      var risposta = await chiediConferma(approva ? 'Approvare ' + quante + '?' : 'Rifiutare ' + quante + '?', testi, approva ? 'Sì, approva' : 'Sì, rifiuta', !approva);
      if (!risposta) return;

      avviso.className = 'stato-lettura';
      avviso.textContent = 'Un momento…';
      var r;
      try {
        r = await window.CaiApi.chiedi('/api/admin/revisione', { method: 'POST', body: { azione: azione, motivo: risposta.motivo, foto: ids } });
      } catch (errore) {
        avviso.textContent = '';
        return mostraEsito('Operazione non riuscita', [{ avviso: true, testo: messaggio(errore && errore.message === 'sessione_scaduta' ? 'sessione_scaduta' : 'rete') }]);
      }
      avviso.textContent = '';
      if (r.stato !== 200 || !r.corpo || !r.corpo.risultati) {
        return mostraEsito('Operazione non riuscita', [{ avviso: true, testo: messaggio(r.corpo && r.corpo.errore) }]);
      }
      var buone = r.corpo.risultati.filter(function (x) { return x.ok; });
      var cattive = r.corpo.risultati.filter(function (x) { return !x.ok; });
      buone.forEach(function (x) { delete selezione[x.idFoto]; });
      var nomi = {};
      ultimo.foto.forEach(function (x) { nomi[x.idFoto] = x.nomeFile; });
      var righe = [];
      if (buone.length) righe.push({ testo: '✅ ' + buone.length + (approva ? (buone.length === 1 ? ' foto approvata.' : ' foto approvate.') : (buone.length === 1 ? ' foto rifiutata.' : ' foto rifiutate.')) });
      cattive.forEach(function (x) { righe.push({ avviso: true, testo: '⚠️ ' + (nomi[x.idFoto] || 'Foto') + ': ' + messaggio(x.errore) }); });
      mostraEsito(cattive.length ? 'Fatto, con qualche problema' : 'Fatto', righe);
      carica();
    }

    // ---- disegno ----
    function visibili() {
      return ultimo ? ultimo.foto.filter(function (f) { return !soloSenza || senzaPosizione(f); }) : [];
    }

    function disegnaSchede() {
      schede.textContent = '';
      SCHEDE.forEach(function (s) {
        var n = ultimo ? ultimo.conteggi[s.id] : 0;
        var b = pulsante(s.titolo + (ultimo ? ' (' + n + ')' : ''), 'scheda-stato' + (s.id === stato ? ' attiva' : ''), function () {
          if (stato === s.id) return;
          stato = s.id;
          selezione = {};
          ultimo = null;
          griglia.textContent = ''; // niente foto dell'elenco precedente mentre si carica il nuovo
          barra.hidden = true;
          disegnaSchede();
          carica();
        });
        schede.appendChild(b);
      });
    }

    function disegnaBarra(elenco) {
      barra.textContent = '';
      barra.hidden = stato !== 'in_attesa' || elenco.length === 0;
      if (barra.hidden) return;
      var scelti = Object.keys(selezione).filter(function (id) { return elenco.some(function (f) { return f.idFoto === id; }); });
      var tutte = document.createElement('input');
      tutte.type = 'checkbox';
      tutte.checked = scelti.length === elenco.length && elenco.length > 0;
      tutte.addEventListener('change', function () {
        selezione = {};
        if (tutte.checked) elenco.forEach(function (f) { selezione[f.idFoto] = true; });
        disegna();
      });
      var etichetta = el('label', 'seleziona-tutte');
      etichetta.appendChild(tutte);
      etichetta.appendChild(el('span', null, ' Seleziona tutte (' + scelti.length + ' scelte)'));
      barra.appendChild(etichetta);
      var approva = pulsante('Approva le scelte', '', function () { revisiona('approva', scelti); });
      var rifiuta = pulsante('Rifiuta le scelte', 'pericolo', function () { revisiona('rifiuta', scelti); });
      approva.disabled = rifiuta.disabled = scelti.length === 0;
      barra.appendChild(approva);
      barra.appendChild(rifiuta);
    }

    function disegnaScheda(f) {
      var s = el('div', 'scheda-foto' + (senzaPosizione(f) ? ' senza-posizione' : ''));
      if (stato === 'in_attesa') {
        var c = document.createElement('input');
        c.type = 'checkbox';
        c.className = 'scelta-foto';
        c.checked = Boolean(selezione[f.idFoto]);
        c.setAttribute('aria-label', 'Scegli ' + f.nomeFile);
        c.addEventListener('change', function () {
          if (c.checked) selezione[f.idFoto] = true; else delete selezione[f.idFoto];
          disegnaBarra(visibili());
        });
        s.appendChild(c);
      }
      var m = el('button', 'miniatura', 'Sto caricando…');
      m.type = 'button';
      m.setAttribute('aria-label', 'Ingrandisci ' + f.nomeFile);
      m.addEventListener('click', function () { apriGrande(f); });
      s.appendChild(m);
      osservaMiniatura(f.idFoto, m);

      var d = el('div', 'dati-foto');
      d.appendChild(el('strong', 'nome-foto', f.nomeFile));
      d.appendChild(el('div', null, '👤 ' + (f.volontario.nome || f.volontario.email || 'autore sconosciuto')));
      if (f.dataSopralluogo) d.appendChild(el('div', 'nota', 'Sopralluogo del ' + soloData(f.dataSopralluogo)));
      if (f.dataScatto) d.appendChild(el('div', 'nota', 'Scattata il ' + dataOra(f.dataScatto)));
      if (senzaPosizione(f)) {
        d.appendChild(el('div', 'esito-foto avviso-testo', '⚠️ Senza posizione'));
      } else {
        var p = el('div', 'esito-foto');
        p.appendChild(document.createTextNode('📍 ' + f.lat.toFixed(5) + ', ' + f.lon.toFixed(5) + ' '));
        var a = el('a', null, 'Apri su OpenStreetMap');
        a.href = 'https://www.openstreetmap.org/?mlat=' + f.lat + '&mlon=' + f.lon + '#map=17/' + f.lat + '/' + f.lon;
        a.target = '_blank';
        a.rel = 'noopener';
        p.appendChild(a);
        d.appendChild(p);
      }
      if (stato !== 'in_attesa') {
        d.appendChild(el('div', 'nota', (stato === 'approvata' ? 'Approvata' : 'Rifiutata') + ' da ' + (f.rivistaDa || '?') + (f.rivistaIl ? ' il ' + dataOra(f.rivistaIl) : '')));
        if (f.motivoRifiuto) d.appendChild(el('div', 'nota', 'Motivo: ' + f.motivoRifiuto));
      } else {
        var az = el('div', 'azioni-foto');
        az.appendChild(pulsante('Approva', 'piccolo', function () { revisiona('approva', [f.idFoto]); }));
        az.appendChild(pulsante('Rifiuta', 'piccolo pericolo', function () { revisiona('rifiuta', [f.idFoto]); }));
        d.appendChild(az);
      }
      s.appendChild(d);
      return s;
    }

    function disegna() {
      generazione++;
      coda = [];
      if (osservatore) { osservatore.disconnect(); osservatore = null; }
      disegnaSchede();
      var elenco = visibili();
      disegnaBarra(elenco);
      griglia.textContent = '';
      elenco.forEach(function (f) { griglia.appendChild(disegnaScheda(f)); });
      if (ultimo && elenco.length === 0) {
        avviso.className = 'stato-lettura';
        avviso.textContent = soloSenza ? 'Nessuna foto senza posizione in questo elenco.' : (stato === 'in_attesa' ? 'Nessuna foto da approvare. 🎉' : 'Nessuna foto in questo elenco.');
      } else if (ultimo && ultimo.totale > ultimo.limite) {
        avviso.className = 'stato-lettura';
        avviso.textContent = 'Sono mostrate le ' + ultimo.limite + ' foto più recenti su ' + ultimo.totale + '.';
      } else if (avviso.className.indexOf('errore-testo') === -1) {
        avviso.textContent = '';
      }
    }

    async function carica() {
      avviso.className = 'stato-lettura';
      avviso.textContent = 'Sto caricando le foto…';
      var r;
      try {
        r = await window.CaiApi.chiedi('/api/admin/foto?stato=' + encodeURIComponent(stato));
      } catch (errore) {
        avviso.className = 'stato-lettura errore-testo';
        avviso.textContent = messaggio(errore && errore.message === 'sessione_scaduta' ? 'sessione_scaduta' : 'rete');
        return;
      }
      if (r.stato !== 200 || !r.corpo) {
        avviso.className = 'stato-lettura errore-testo';
        avviso.textContent = messaggio(r.corpo && r.corpo.errore);
        return;
      }
      ultimo = r.corpo;
      avviso.textContent = '';
      disegna();
    }

    casella.addEventListener('change', function () { soloSenza = casella.checked; selezione = {}; disegna(); });

    function azzera() {
      chiudiModale();
      generazione++;
      coda = [];
      if (osservatore) { osservatore.disconnect(); osservatore = null; }
      Object.keys(miniature).forEach(function (id) { URL.revokeObjectURL(miniature[id]); });
      miniature = {};
      ultimo = null;
      selezione = {};
      stato = 'in_attesa';
      soloSenza = false;
      casella.checked = false;
      griglia.textContent = '';
      barra.textContent = '';
      avviso.textContent = '';
      disegnaSchede();
    }

    disegnaSchede();
    return { ricarica: carica, azzera: azzera };
  }

  window.Dashboard = { avvia: avvia };
})();
