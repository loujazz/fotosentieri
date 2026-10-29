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

  function avvia(contenitore) {
    var mappa = null;
    var gruppo = null;
    var miniature = {}; // idFoto -> indirizzo dell'immagine (oggetto del browser)
    var sfondoGrande = null;

    contenitore.textContent = '';
    var riepilogo = el('p', 'stato-lettura');
    riepilogo.setAttribute('aria-live', 'polite');
    var area = el('div', 'area-mappa');
    area.setAttribute('role', 'application');
    area.setAttribute('aria-label', 'Mappa delle foto approvate');
    var nota = el('p', 'nota');
    contenitore.appendChild(riepilogo);
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
      L.control.layers({ 'Mappa stradale': stradale, 'Mappa topografica': topografica }, null, { collapsed: false }).addTo(mappa);
      gruppo = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
      mappa.addLayer(gruppo);
    }

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
      return carica();
    }

    function azzera() {
      chiudiGrande();
      Object.keys(miniature).forEach(function (id) { URL.revokeObjectURL(miniature[id]); });
      miniature = {};
      if (mappa) { mappa.remove(); mappa = null; gruppo = null; }
      riepilogo.textContent = '';
      nota.textContent = '';
    }

    return { mostra: mostra, azzera: azzera };
  }

  window.Mappa = { avvia: avvia };
})();
