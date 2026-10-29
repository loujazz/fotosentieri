// Mappa riservata (solo amministratori): le foto approvate con posizione, raggruppate quando sono vicine.
// Cartine di sfondo: OpenStreetMap e OpenTopoMap (topografica). Richiede Leaflet e leaflet.markercluster
// (public/vendor/leaflet/) e CaiApi (app.js). Nessuna foto o miniatura è pubblica: le miniature si
// scaricano con il biglietto di sessione, solo quando si apre l'anteprima di un punto.
(function () {
  'use strict';

  var CENTRO_INIZIALE = [44.4949, 11.3426]; // Bologna
  var ZOOM_INIZIALE = 9;
  var ZOOM_MASSIMO_ADATTAMENTO = 15;

  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined) e.textContent = testo;
    return e;
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

  // Tipo di problema, settore, sentiero e nota scritti dal volontario (i campi vuoti non si mostrano).
  function aggiungiDescrizione(contenitore, f) {
    if (f.etichetta) contenitore.appendChild(el('div', 'etichetta-foto', '🏷️ ' + f.etichetta));
    var dove = [f.settore ? 'Settore ' + f.settore : '', f.sentiero ? 'Sentiero ' + f.sentiero : ''].filter(Boolean).join(' · ');
    if (dove) contenitore.appendChild(el('div', null, '🥾 ' + dove));
    if (f.nota) contenitore.appendChild(el('div', 'nota-volontario', '💬 ' + f.nota));
  }

  function avvia(contenitore) {
    var mappa = null;
    var gruppo = null;
    var miniature = {}; // idFoto -> indirizzo dell'immagine (oggetto del browser)
    var sfondoGrande = null;
    var controlloLivelli = null;
    var livelloSentieri = null; // L.layerGroup con i tracciati dei sentieri CAI
    var tracciati = {}; // idPercorso -> { dati (numero, nome, ...), linea (L.polyline) }
    var menuSentieri = null;
    var sentieriCaricati = false;

    contenitore.textContent = '';
    var riepilogo = el('p', 'stato-lettura');
    riepilogo.setAttribute('aria-live', 'polite');
    var area = el('div', 'area-mappa');
    area.setAttribute('role', 'application');
    area.setAttribute('aria-label', 'Mappa delle foto approvate');
    var nota = el('p', 'nota');
    var barraSentieri = el('div', 'barra-sentieri');
    var etichettaComune = el('label', 'campo-data');
    etichettaComune.appendChild(el('span', null, 'Sentieri CAI: comune'));
    var sceltaComune = document.createElement('select');
    etichettaComune.appendChild(sceltaComune);
    var etichettaSentiero = el('label', 'campo-data');
    etichettaSentiero.appendChild(el('span', null, 'Sentiero del comune'));
    var sceltaSentiero = document.createElement('select');
    sceltaSentiero.disabled = true;
    etichettaSentiero.appendChild(sceltaSentiero);
    var etichettaCerca = el('label', 'campo-data');
    etichettaCerca.appendChild(el('span', null, 'Oppure cerca per numero o nome'));
    var campoCerca = document.createElement('input');
    campoCerca.type = 'search';
    campoCerca.autocomplete = 'off';
    etichettaCerca.appendChild(campoCerca);
    barraSentieri.appendChild(etichettaComune);
    barraSentieri.appendChild(etichettaSentiero);
    barraSentieri.appendChild(etichettaCerca);
    barraSentieri.hidden = true;
    var statoSentieri = el('p', 'nota');
    statoSentieri.setAttribute('aria-live', 'polite');
    contenitore.appendChild(riepilogo);
    contenitore.appendChild(barraSentieri);
    contenitore.appendChild(statoSentieri);
    contenitore.appendChild(area);
    contenitore.appendChild(nota);

    function creaMappa() {
      if (mappa) return;
      mappa = L.map(area).setView(CENTRO_INIZIALE, ZOOM_INIZIALE);
      var stradale = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      });
      var topografica = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        subdomains: 'abc',
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, SRTM · stile © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)',
      });
      stradale.addTo(mappa);
      controlloLivelli = L.control.layers({ 'Mappa stradale': stradale, 'Mappa topografica': topografica }, null, { collapsed: false }).addTo(mappa);
      gruppo = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
      mappa.addLayer(gruppo);
    }

    // ---- sentieri CAI (OSM2CAI), dai dati già sincronizzati ----
    var ATTRIBUZIONE_CAI = '© CAI - INFOMONT, derivati da OpenStreetMap. Disponibili con licenza <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">ODbL</a>';
    var STILE = { color: '#b3261e', weight: 3, opacity: 0.85 };
    var STILE_RISALTO = { color: '#0b57d0', weight: 5, opacity: 1 };

    function schedaSentiero(p) {
      var c = el('div', 'scheda-sentiero');
      c.appendChild(el('strong', null, [p.ref, p.nome ? '– ' + p.nome : ''].filter(Boolean).join(' ')));
      if (p.da && p.a) c.appendChild(el('div', null, p.da + ' → ' + p.a));
      if (p.comuni.length) c.appendChild(el('div', 'nota', 'Comuni: ' + p.comuni.join(', ')));
      var nomi = menuSentieri.settori.filter(function (s) { return p.settori.indexOf(s.id) !== -1; })
        .map(function (s) { return window.CaiMenu.nomeSettore(s); });
      if (nomi.length) c.appendChild(el('div', 'nota', 'Settore: ' + nomi.join(', ')));
      return c;
    }

    // Mostra solo i sentieri che corrispondono a comune e ricerca; con un filtro attivo la mappa si porta su di loro.
    function applicaFiltro() {
      if (!menuSentieri || !livelloSentieri) return;
      var comune = sceltaComune.value;
      var testo = campoCerca.value;
      var scelto = sceltaSentiero.value; // un sentiero scelto dall'elenco del comune
      var visibili = {};
      if (scelto) visibili[scelto] = true;
      else window.CaiMenu.filtra(menuSentieri, { comune: comune, testo: testo }).forEach(function (p) { visibili[p.id] = true; });
      var limiti = null;
      var mostrati = 0;
      Object.keys(tracciati).forEach(function (id) {
        var t = tracciati[id];
        if (visibili[id]) {
          if (!livelloSentieri.hasLayer(t.linea)) livelloSentieri.addLayer(t.linea);
          t.linea.setStyle(comune || testo || scelto ? STILE_RISALTO : STILE);
          limiti = limiti ? limiti.extend(t.linea.getBounds()) : L.latLngBounds(t.linea.getBounds().getSouthWest(), t.linea.getBounds().getNorthEast());
          mostrati++;
        } else if (livelloSentieri.hasLayer(t.linea)) {
          livelloSentieri.removeLayer(t.linea);
        }
      });
      if ((comune || testo) && limiti) mappa.fitBounds(limiti, { padding: [40, 40], maxZoom: ZOOM_MASSIMO_ADATTAMENTO });
      if (scelto && tracciati[scelto]) tracciati[scelto].linea.openPopup(tracciati[scelto].linea.getBounds().getCenter());
      if (comune || testo || scelto) {
        statoSentieri.textContent = mostrati === 0 ? 'Nessun sentiero corrisponde.' : (mostrati === 1 ? '1 sentiero trovato.' : mostrati + ' sentieri trovati.');
      } else {
        statoSentieri.textContent = Object.keys(tracciati).length + ' sentieri CAI sulla mappa. Cliccando un sentiero si vedono numero, nome e comuni.';
      }
    }

    async function caricaSentieri() {
      if (sentieriCaricati || !mappa) return;
      statoSentieri.className = 'nota';
      statoSentieri.textContent = 'Sto caricando i sentieri CAI…';
      var r;
      try {
        r = await window.CaiApi.chiedi('/api/sentieri');
      } catch (errore) {
        statoSentieri.className = 'nota avviso-testo';
        statoSentieri.textContent = 'I sentieri CAI non si sono caricati (connessione interrotta). Le foto si vedono lo stesso.';
        return;
      }
      if (r.stato !== 200 || !r.corpo || !Array.isArray(r.corpo.percorsi)) {
        statoSentieri.className = 'nota avviso-testo';
        statoSentieri.textContent = 'I sentieri CAI non si sono caricati. Le foto si vedono lo stesso.';
        return;
      }
      menuSentieri = r.corpo;
      if (menuSentieri.percorsi.length === 0) {
        statoSentieri.textContent = 'I sentieri CAI compaiono dopo la prima sincronizzazione e l\'attivazione dei settori (sezione «Sentieri»).';
        return;
      }
      livelloSentieri = L.layerGroup([], { attribution: ATTRIBUZIONE_CAI });
      livelloSentieri.addTo(mappa);
      controlloLivelli.addOverlay(livelloSentieri, 'Sentieri CAI');
      sceltaComune.textContent = '';
      sceltaComune.appendChild(new Option('Tutti i comuni', ''));
      menuSentieri.comuni.forEach(function (c) { sceltaComune.appendChild(new Option(c, c)); });
      riempiSentieriDelComune();
      barraSentieri.hidden = false;
      var perId = {};
      menuSentieri.percorsi.forEach(function (p) { perId[p.id] = p; });
      var mancanti = 0;
      for (var i = 0; i < menuSentieri.settori.length; i++) {
        var s = menuSentieri.settori[i];
        statoSentieri.textContent = 'Sto caricando i sentieri CAI… settore ' + (i + 1) + ' di ' + menuSentieri.settori.length + '.';
        var t;
        try {
          t = await window.CaiApi.chiedi('/api/admin/tracciati?settore=' + encodeURIComponent(s.id));
        } catch (errore) {
          if (!mappa) return; // la sezione è stata chiusa nel frattempo
          mancanti++;
          continue;
        }
        if (!mappa) return;
        if (t.stato !== 200 || !t.corpo) { mancanti++; continue; }
        Object.keys(t.corpo.tracciati).forEach(function (id) {
          if (tracciati[id] || !perId[id]) return;
          var p = perId[id];
          var linea = L.polyline(t.corpo.tracciati[id].map(function (parte) {
            return parte.map(function (pt) { return [pt[1], pt[0]]; });
          }), STILE);
          var scheda = null;
          linea.bindPopup(function () { if (!scheda) scheda = schedaSentiero(p); return scheda; }, { maxWidth: 280 });
          linea.on('mouseover', function () { linea.setStyle({ weight: 6 }); });
          linea.on('mouseout', function () { linea.setStyle(sceltaComune.value || campoCerca.value || sceltaSentiero.value ? STILE_RISALTO : STILE); });
          tracciati[id] = { dati: p, linea: linea };
          livelloSentieri.addLayer(linea);
        });
      }
      sentieriCaricati = true;
      applicaFiltro();
      if (mancanti) {
        statoSentieri.className = 'nota avviso-testo';
        statoSentieri.textContent += ' ' + (mancanti === 1 ? 'Un settore non si è caricato.' : mancanti + ' settori non si sono caricati.') + ' Riapri la sezione per riprovare.';
        sentieriCaricati = false;
      }
    }

    // Il menu dei sentieri si riempie quando si sceglie un comune; senza comune resta spento.
    function riempiSentieriDelComune() {
      sceltaSentiero.textContent = '';
      var comune = sceltaComune.value;
      sceltaSentiero.disabled = !comune || !menuSentieri;
      if (!comune || !menuSentieri) {
        sceltaSentiero.appendChild(new Option('Scegli prima un comune', ''));
        return;
      }
      var elenco = window.CaiMenu.filtra(menuSentieri, { comune: comune });
      sceltaSentiero.appendChild(new Option('Tutti i sentieri del comune (' + elenco.length + ')', ''));
      elenco.forEach(function (p) { sceltaSentiero.appendChild(new Option(window.CaiMenu.testoSentiero(p), String(p.id))); });
    }

    sceltaComune.addEventListener('change', function () { riempiSentieriDelComune(); campoCerca.value = ''; applicaFiltro(); });
    sceltaSentiero.addEventListener('change', function () { campoCerca.value = ''; applicaFiltro(); });
    campoCerca.addEventListener('input', function () { sceltaSentiero.value = ''; applicaFiltro(); });

    // ---- foto ingrandita ----
    function chiudiGrande() {
      if (!sfondoGrande) return;
      document.removeEventListener('keydown', sfondoGrande.tasti);
      sfondoGrande.sfondo.remove();
      sfondoGrande = null;
    }

    function apriGrande(f) {
      chiudiGrande();
      var sfondo = el('div', 'modale-sfondo');
      var finestra = el('div', 'modale larga');
      finestra.setAttribute('role', 'dialog');
      finestra.setAttribute('aria-modal', 'true');
      finestra.appendChild(el('h3', 'nome-foto', f.nomeFile));
      var foto = el('div', 'foto-grande', 'Sto caricando la foto…');
      finestra.appendChild(foto);
      aggiungiDescrizione(finestra, f);
      var chiudi = el('button', null, 'Chiudi');
      chiudi.type = 'button';
      chiudi.addEventListener('click', chiudiGrande);
      finestra.appendChild(el('div', 'azioni-modale')).appendChild(chiudi);
      sfondo.appendChild(finestra);
      sfondo.addEventListener('click', function (e) { if (e.target === sfondo) chiudiGrande(); });
      var tasti = function (e) { if (e.key === 'Escape') chiudiGrande(); };
      document.addEventListener('keydown', tasti);
      document.body.appendChild(sfondo);
      sfondoGrande = { sfondo: sfondo, tasti: tasti };
      window.CaiApi.blob('/api/admin/anteprima?id=' + encodeURIComponent(f.idFoto) + '&misura=grande').then(function (blob) {
        var indirizzo = URL.createObjectURL(blob);
        var img = el('img', 'foto-grande-img');
        img.alt = f.nomeFile;
        img.onload = function () { URL.revokeObjectURL(indirizzo); };
        img.src = indirizzo;
        foto.textContent = '';
        foto.appendChild(img);
      }).catch(function () {
        foto.textContent = 'Anteprima non disponibile per questa foto.';
      });
    }

    // ---- scheda che si apre sul punto ----
    function contenutoScheda(f, marcatore) {
      var c = el('div', 'scheda-mappa');
      var m = el('button', 'miniatura', 'Sto caricando…');
      m.type = 'button';
      m.setAttribute('aria-label', 'Ingrandisci ' + f.nomeFile);
      m.addEventListener('click', function () { apriGrande(f); });
      c.appendChild(m);
      c.appendChild(el('strong', 'nome-foto', f.nomeFile));
      if (f.volontario) c.appendChild(el('div', null, '👤 ' + f.volontario));
      aggiungiDescrizione(c, f);
      if (f.dataSopralluogo) c.appendChild(el('div', 'nota', 'Sopralluogo del ' + soloData(f.dataSopralluogo)));
      if (f.dataScatto) c.appendChild(el('div', 'nota', 'Scattata il ' + dataOra(f.dataScatto)));
      var p = el('div', 'nota');
      p.appendChild(document.createTextNode('📍 ' + f.lat.toFixed(5) + ', ' + f.lon.toFixed(5) + ' '));
      var a = el('a', null, 'Apri su OpenStreetMap');
      a.href = 'https://www.openstreetmap.org/?mlat=' + f.lat + '&mlon=' + f.lon + '#map=17/' + f.lat + '/' + f.lon;
      a.target = '_blank';
      a.rel = 'noopener';
      p.appendChild(a);
      c.appendChild(p);

      var mostraImmagine = function (indirizzo) {
        m.textContent = '';
        var img = el('img', 'miniatura-img');
        img.alt = '';
        img.onload = function () { if (marcatore.getPopup()) marcatore.getPopup().update(); };
        img.src = indirizzo;
        m.appendChild(img);
      };
      if (miniature[f.idFoto]) {
        mostraImmagine(miniature[f.idFoto]);
      } else {
        window.CaiApi.blob('/api/admin/anteprima?id=' + encodeURIComponent(f.idFoto) + '&misura=piccola').then(function (blob) {
          miniature[f.idFoto] = URL.createObjectURL(blob);
          mostraImmagine(miniature[f.idFoto]);
        }).catch(function () {
          m.textContent = 'Anteprima non disponibile';
        });
      }
      return c;
    }

    function disegna(dati) {
      gruppo.clearLayers();
      var punti = [];
      dati.foto.forEach(function (f) {
        var marcatore = L.marker([f.lat, f.lon], { title: f.nomeFile, alt: f.nomeFile });
        // Il contenuto si crea una volta sola: Leaflet richiama la funzione a ogni popup.update(),
        // e ricrearlo farebbe ripartire il caricamento della miniatura all'infinito.
        var scheda = null;
        marcatore.bindPopup(function () {
          if (!scheda) scheda = contenutoScheda(f, marcatore);
          return scheda;
        }, { minWidth: 240, maxWidth: 300 });
        gruppo.addLayer(marcatore);
        punti.push([f.lat, f.lon]);
      });
      if (punti.length) {
        mappa.fitBounds(L.latLngBounds(punti), { padding: [40, 40], maxZoom: ZOOM_MASSIMO_ADATTAMENTO });
      } else {
        mappa.setView(CENTRO_INIZIALE, ZOOM_INIZIALE);
      }
      riepilogo.className = 'stato-lettura';
      riepilogo.textContent = dati.totale === 0
        ? 'Ancora nessuna foto approvata con la posizione.'
        : (dati.totale === 1 ? '1 foto sulla mappa.' : dati.totale + ' foto sulla mappa.') +
          (dati.totale > dati.limite ? ' Sono mostrate le ' + dati.limite + ' più recenti.' : '');
      nota.textContent = dati.senzaPosizione
        ? (dati.senzaPosizione === 1 ? '1 foto approvata non ha la posizione e non può comparire sulla mappa.' : dati.senzaPosizione + ' foto approvate non hanno la posizione e non possono comparire sulla mappa.')
        : '';
    }

    async function carica() {
      riepilogo.className = 'stato-lettura';
      riepilogo.textContent = 'Sto caricando la mappa…';
      var r;
      try {
        r = await window.CaiApi.chiedi('/api/admin/mappa');
      } catch (errore) {
        riepilogo.className = 'stato-lettura errore-testo';
        riepilogo.textContent = errore && errore.message === 'sessione_scaduta'
          ? 'La sessione è scaduta: accedi di nuovo.'
          : 'Connessione interrotta. Controlla internet e riprova.';
        return;
      }
      if (r.stato !== 200 || !r.corpo) {
        riepilogo.className = 'stato-lettura errore-testo';
        riepilogo.textContent = 'Non riesco a caricare la mappa. Riprova tra poco; se continua, avvisa un amministratore.';
        return;
      }
      disegna(r.corpo);
    }

    // Da chiamare quando la sezione diventa visibile (Leaflet ha bisogno di conoscere la dimensione).
    function mostra() {
      creaMappa();
      mappa.invalidateSize();
      return Promise.all([carica(), sentieriCaricati ? Promise.resolve() : (resetSentieri(), caricaSentieri())]);
    }

    // Prima di ricaricare i sentieri si toglie ciò che era rimasto di un tentativo incompleto.
    function resetSentieri() {
      Object.keys(tracciati).forEach(function (id) { if (livelloSentieri) livelloSentieri.removeLayer(tracciati[id].linea); });
      tracciati = {};
      if (livelloSentieri && mappa) { mappa.removeLayer(livelloSentieri); controlloLivelli.removeLayer(livelloSentieri); }
      livelloSentieri = null;
    }

    function azzera() {
      chiudiGrande();
      Object.keys(miniature).forEach(function (id) { URL.revokeObjectURL(miniature[id]); });
      miniature = {};
      if (mappa) { mappa.remove(); mappa = null; gruppo = null; controlloLivelli = null; }
      livelloSentieri = null;
      tracciati = {};
      menuSentieri = null;
      sentieriCaricati = false;
      barraSentieri.hidden = true;
      statoSentieri.textContent = '';
      campoCerca.value = '';
      sceltaSentiero.textContent = '';
      sceltaComune.value = '';
      riepilogo.textContent = '';
      nota.textContent = '';
    }

    return { mostra: mostra, azzera: azzera };
  }

  window.Mappa = { avvia: avvia };
})();
