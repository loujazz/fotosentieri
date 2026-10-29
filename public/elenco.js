// Elenco in tabella di tutte le foto (admin): filtri, ordinamento e pagine. Solo consultazione: un clic su una riga apre la scheda
// della foto (miniatura, dati e azioni) gestita dalla dashboard. I filtri li applica il server (api/admin/elenco).
(function () {
  'use strict';

  var COLONNE = [
    { id: 'dataSopralluogo', titolo: 'Sopralluogo' },
    { id: 'volontario', titolo: 'Volontario' },
    { id: 'comune', titolo: 'Comune' },
    { id: 'settore', titolo: 'Settore' },
    { id: 'sentiero', titolo: 'Sentiero' },
    { id: 'problema', titolo: 'Problema' },
    { id: 'stato', titolo: 'Stato' },
    { id: 'posizione', titolo: 'Posizione', nonOrdinabile: true },
    { id: 'nota', titolo: 'Nota', nonOrdinabile: true },
    { id: 'dataScatto', titolo: 'Scatto' },
    { id: 'rivistaIl', titolo: 'Rivista' },
    { id: 'nomeFile', titolo: 'File' },
  ];
  var NON_INDICATO = '(non indicato)';
  var NESSUNO = '(nessuno)';
  var STATI = { in_attesa: '⏳ Da approvare', approvata: '✅ Approvata', rifiutata: '❌ Rifiutata' };

  var MESSAGGI = {
    rete: 'Connessione interrotta. Controlla internet e riprova.',
    sessione_scaduta: 'La sessione è scaduta: accedi di nuovo.',
    generico: 'Non riesco a caricare l\'elenco. Riprova tra poco; se continua, avvisa un amministratore.',
  };

  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined) e.textContent = testo;
    return e;
  }

  function soloData(testo) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(testo || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  function dataBreve(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  function accorcia(t, n) {
    t = String(t || '');
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  // opzioni.apriScheda(foto, dopo): apre la scheda della foto (dalla dashboard).
  function avvia(contenitore, opzioni) {
    var apriScheda = opzioni && opzioni.apriScheda;
    var filtri = { stato: '', comune: '', sentiero: '', problema: '', volontario: '', settore: '', tipoData: 'sopralluogo', da: '', a: '' };
    var ordine = { campo: 'dataInvio', verso: 'desc' };
    var pagina = 1;
    var perPagina = 50;
    var dati = null;
    var generazione = 0;

    contenitore.textContent = '';
    var intro = el('p', 'nota', 'Tutte le foto in una tabella. Filtra, ordina cliccando sull\'intestazione di una colonna e clicca una riga per vedere la foto e fare le azioni. Il comune è quello del sentiero scelto dal volontario: se non l\'ha indicato, risulta «non indicato».');
    var pannelloFiltri = el('div', 'filtri-elenco');
    var avviso = el('p', 'stato-lettura');
    avviso.setAttribute('aria-live', 'polite');
    var riepilogo = el('p', 'nota');
    var scorrimento = el('div', 'tabella-scorrevole');
    var tabella = document.createElement('table');
    tabella.className = 'tabella-foto';
    scorrimento.appendChild(tabella);
    var pie = el('div', 'pie-elenco');
    [intro, pannelloFiltri, avviso, riepilogo, scorrimento, pie].forEach(function (n) { contenitore.appendChild(n); });

    // ---- filtri ----
    var campi = {};
    function menu(id, etichetta) {
      var l = el('label', 'campo-data');
      l.appendChild(el('span', null, etichetta));
      var s = document.createElement('select');
      s.addEventListener('change', function () { filtri[id] = s.value; pagina = 1; carica(); });
      l.appendChild(s);
      pannelloFiltri.appendChild(l);
      campi[id] = s;
      return s;
    }
    function riempi(sel, voci, primo, valore) {
      sel.textContent = '';
      sel.appendChild(new Option(primo, ''));
      voci.forEach(function (v) { sel.appendChild(new Option(v[1], v[0])); });
      sel.value = valore;
      if (sel.value !== valore) { sel.value = ''; }
    }
    menu('stato', 'Stato');
    menu('comune', 'Comune');
    menu('sentiero', 'Sentiero');
    menu('problema', 'Tipo di problema');
    menu('volontario', 'Volontario');
    menu('settore', 'Settore');

    var rigaData = el('div', 'filtro-date');
    var etTipo = el('label', 'campo-data');
    etTipo.appendChild(el('span', null, 'Data'));
    var tipoData = document.createElement('select');
    [['sopralluogo', 'del sopralluogo'], ['scatto', 'di scatto'], ['invio', 'di invio'], ['revisione', 'di revisione']].forEach(function (t) { tipoData.appendChild(new Option(t[1], t[0])); });
    etTipo.appendChild(tipoData);
    var etDa = el('label', 'campo-data');
    etDa.appendChild(el('span', null, 'dal'));
    var campoDa = document.createElement('input');
    campoDa.type = 'date';
    etDa.appendChild(campoDa);
    var etA = el('label', 'campo-data');
    etA.appendChild(el('span', null, 'al'));
    var campoA = document.createElement('input');
    campoA.type = 'date';
    etA.appendChild(campoA);
    [etTipo, etDa, etA].forEach(function (n) { rigaData.appendChild(n); });
    pannelloFiltri.appendChild(rigaData);
    tipoData.addEventListener('change', function () { filtri.tipoData = tipoData.value; if (filtri.da || filtri.a) { pagina = 1; carica(); } });
    campoDa.addEventListener('change', function () { filtri.da = campoDa.value; pagina = 1; carica(); });
    campoA.addEventListener('change', function () { filtri.a = campoA.value; pagina = 1; carica(); });

    var azzera = el('button', 'secondario piccolo', 'Azzera i filtri');
    azzera.type = 'button';
    azzera.addEventListener('click', function () {
      filtri = { stato: '', comune: '', sentiero: '', problema: '', volontario: '', settore: '', tipoData: 'sopralluogo', da: '', a: '' };
      campoDa.value = campoA.value = '';
      tipoData.value = 'sopralluogo';
      pagina = 1;
      carica();
    });
    pannelloFiltri.appendChild(azzera);

    function aggiornaMenu(f) {
      riempi(campi.stato, [['in_attesa', 'Da approvare'], ['approvata', 'Approvate'], ['rifiutata', 'Rifiutate']], 'Tutti', filtri.stato);
      riempi(campi.comune, f.comuni.map(function (c) { return [c, c]; }).concat([[NON_INDICATO, 'Non indicato']]), 'Tutti', filtri.comune);
      // Se è scelto un comune, nel menu dei sentieri restano solo i suoi.
      var sentieri = f.sentieri.filter(function (s) { return !filtri.comune || filtri.comune === NON_INDICATO || s.comuni.indexOf(filtri.comune) !== -1; });
      riempi(campi.sentiero, sentieri.map(function (s) { return [s.chiave, s.etichetta]; }).concat([[NON_INDICATO, 'Non indicato']]), 'Tutti', filtri.sentiero);
      riempi(campi.problema, f.problemi.map(function (p) { return [p, p]; }).concat([[NESSUNO, 'Nessuno in particolare']]), 'Tutti', filtri.problema);
      riempi(campi.volontario, f.volontari.map(function (v) { return [v.email, v.nome ? v.nome + ' (' + v.email + ')' : v.email]; }), 'Tutti', filtri.volontario);
      riempi(campi.settore, f.settori.map(function (s) { return [s.chiave, s.etichetta]; }).concat([[NON_INDICATO, 'Non indicato']]), 'Tutti', filtri.settore);
      filtri.stato = campi.stato.value; filtri.comune = campi.comune.value; filtri.sentiero = campi.sentiero.value;
      filtri.problema = campi.problema.value; filtri.volontario = campi.volontario.value; filtri.settore = campi.settore.value;
    }

    // ---- tabella ----
    function posizione(r) {
      if (r.lat === null || r.lon === null) return '⚠️ senza';
      return r.fontePosizione === 'correzione_admin' ? '📍 admin' : '✅ sì';
    }

    function disegnaTabella() {
      tabella.textContent = '';
      var testata = document.createElement('thead');
      var rigaT = document.createElement('tr');
      COLONNE.forEach(function (c) {
        var th = document.createElement('th');
        th.scope = 'col';
        if (c.nonOrdinabile) {
          th.textContent = c.titolo;
        } else {
          var attiva = ordine.campo === c.id;
          th.setAttribute('aria-sort', attiva ? (ordine.verso === 'asc' ? 'ascending' : 'descending') : 'none');
          var b = el('button', 'intestazione', c.titolo + (attiva ? (ordine.verso === 'asc' ? ' ▲' : ' ▼') : ''));
          b.type = 'button';
          b.title = 'Ordina per ' + c.titolo.toLowerCase();
          b.addEventListener('click', function () {
            ordine = { campo: c.id, verso: ordine.campo === c.id && ordine.verso === 'asc' ? 'desc' : 'asc' };
            pagina = 1;
            carica();
          });
          th.appendChild(b);
        }
        rigaT.appendChild(th);
      });
      testata.appendChild(rigaT);
      tabella.appendChild(testata);
      var corpo = document.createElement('tbody');
      ((dati && dati.righe) || []).forEach(function (r) {
        var tr = document.createElement('tr');
        tr.className = 'riga-foto stato-' + r.stato;
        tr.tabIndex = 0;
        tr.setAttribute('role', 'button');
        tr.setAttribute('aria-label', 'Apri la foto ' + r.nomeFile);
        var celle = [
          soloData(r.dataSopralluogo), r.volontario.nome || r.volontario.email, r.comuni.join(', ') || '—', r.settoreEtichetta || '—', r.sentieroEtichetta || '—',
          r.etichetta || '—', STATI[r.stato] || r.stato, posizione(r), accorcia(r.nota, 60), dataBreve(r.dataScatto), r.rivistaIl ? dataBreve(r.rivistaIl) + (r.rivistaDa ? ' · ' + r.rivistaDa : '') : '—', r.nomeFile,
        ];
        celle.forEach(function (t) { tr.appendChild(el('td', null, t)); });
        var apri = function () { if (apriScheda) apriScheda(r, function () { carica(); }); };
        tr.addEventListener('click', apri);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apri(); } });
        corpo.appendChild(tr);
      });
      tabella.appendChild(corpo);
    }

    function disegnaPie() {
      pie.textContent = '';
      if (!dati) return;
      var indietro = el('button', 'secondario piccolo', '← Precedente');
      indietro.type = 'button';
      indietro.disabled = dati.pagina <= 1;
      indietro.addEventListener('click', function () { pagina = dati.pagina - 1; carica(); });
      var avanti = el('button', 'secondario piccolo', 'Successiva →');
      avanti.type = 'button';
      avanti.disabled = dati.pagina >= dati.pagine;
      avanti.addEventListener('click', function () { pagina = dati.pagina + 1; carica(); });
      var pp = el('label', 'campo-data per-pagina');
      pp.appendChild(el('span', null, 'Righe per pagina'));
      var sel = document.createElement('select');
      [25, 50, 100].forEach(function (n) { sel.appendChild(new Option(String(n), String(n))); });
      sel.value = String(perPagina);
      sel.addEventListener('change', function () { perPagina = Number(sel.value); pagina = 1; carica(); });
      pp.appendChild(sel);
      [indietro, el('span', 'pagina-corrente', 'Pagina ' + dati.pagina + ' di ' + dati.pagine), avanti, pp].forEach(function (n) { pie.appendChild(n); });
    }

    function disegna() {
      aggiornaMenu(dati.faccette);
      var filtrato = dati.totale !== dati.tutte;
      riepilogo.textContent = dati.tutte === 0 ? 'Non ci sono ancora foto.' :
        (dati.totale === 1 ? '1 foto' : dati.totale + ' foto') + (filtrato ? ' su ' + dati.tutte + ' (con i filtri scelti)' : '') + '.';
      scorrimento.hidden = dati.totale === 0;
      if (dati.totale === 0 && dati.tutte > 0) riepilogo.textContent = 'Nessuna foto corrisponde ai filtri. Prova ad allargarli o premi «Azzera i filtri».';
      disegnaTabella();
      disegnaPie();
    }

    async function carica() {
      var mia = ++generazione;
      avviso.className = 'stato-lettura';
      avviso.textContent = 'Sto caricando l\'elenco…';
      var p = new URLSearchParams();
      Object.keys(filtri).forEach(function (k) { if (filtri[k]) p.set(k, filtri[k]); });
      p.set('ordina', ordine.campo);
      p.set('verso', ordine.verso);
      p.set('pagina', String(pagina));
      p.set('perPagina', String(perPagina));
      var r;
      try {
        r = await window.CaiApi.chiedi('/api/admin/elenco?' + p.toString());
      } catch (errore) {
        if (mia !== generazione) return;
        avviso.className = 'stato-lettura errore-testo';
        avviso.textContent = MESSAGGI[errore && errore.message === 'sessione_scaduta' ? 'sessione_scaduta' : 'rete'];
        return;
      }
      if (mia !== generazione) return; // un'altra richiesta più recente ha preso il posto di questa
      if (r.stato !== 200 || !r.corpo) {
        avviso.className = 'stato-lettura errore-testo';
        avviso.textContent = MESSAGGI.generico;
        return;
      }
      dati = r.corpo;
      pagina = dati.pagina;
      avviso.textContent = '';
      disegna();
    }

    function chiudi() {
      generazione++;
      dati = null;
      tabella.textContent = '';
      pie.textContent = '';
      riepilogo.textContent = '';
      avviso.textContent = '';
      filtri = { stato: '', comune: '', sentiero: '', problema: '', volontario: '', settore: '', tipoData: 'sopralluogo', da: '', a: '' };
      ordine = { campo: 'dataInvio', verso: 'desc' };
      pagina = 1;
      campoDa.value = campoA.value = '';
      tipoData.value = 'sopralluogo';
    }

    return { mostra: carica, azzera: chiudi };
  }

  window.Elenco = { avvia: avvia };
})();
