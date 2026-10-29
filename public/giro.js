// Giro guidato per i volontari: pochi fumetti che mostrano dove cliccare. Compare la prima volta (in questo browser) e si
// può rivedere con il pulsante «Come si usa». Nessuna libreria esterna. Se un elemento non c'è ancora sulla pagina (per
// esempio l'elenco delle foto, che compare dopo averle scelte), il fumetto si mostra al centro.
(function () {
  'use strict';

  var CHIAVE = 'cai-giro-visto-v1'; // se cambia molto la pagina, si cambia il numero e il giro ricompare a tutti

  var PASSI = [
    {
      titolo: 'Benvenuto! Come si inviano le foto',
      testo: 'In 5 passi vedi come funziona. Le foto vanno caricate da un computer: da cellulare il sito non riesce a leggere la posizione. Puoi rivedere questo giro quando vuoi con «Come si usa».',
    },
    {
      selettore: '#sezione-carica .scelta-file',
      titolo: '1. Scegli le foto',
      testo: 'Premi qui e scegli le foto scaricate da Google Foto, oppure direttamente il file ZIP: non serve aprirlo.',
    },
    {
      titolo: '2. Controlla l\'elenco',
      testo: 'Ogni foto mostra se ha la posizione: ✅ con posizione, ⚠️ senza posizione (si può inviare, ma gli amministratori la vedranno segnalata), ❌ non leggibile (non si invia).',
    },
    {
      titolo: '3. Che problema c\'è?',
      testo: 'Per ogni foto scegli il tipo di problema e, se vuoi, scrivi una nota. Con più foto puoi spuntarle e dare a tutte lo stesso problema. Con «Altro» la nota è obbligatoria.',
    },
    {
      titolo: '4. Dove e quando, poi «Invia»',
      testo: 'Se vuoi, scegli settore, comune e sentiero (anche cercando il numero). Controlla la data del sopralluogo e premi «Invia». Non chiudere la pagina finché non compare «Fatto».',
    },
    {
      selettore: '#volontario-navigazione [data-sezione="invii"]',
      titolo: '5. Guarda cosa è successo',
      testo: 'In «I miei invii» vedi se le tue foto sono in attesa, approvate o rifiutate (con il motivo).',
    },
    {
      selettore: '#come-si-usa',
      titolo: 'Hai bisogno di aiuto?',
      testo: 'Questo pulsante rifà il giro in qualsiasi momento. «Guida completa» apre la guida con tutti i dettagli, anche su Google Foto.',
    },
  ];

  var stato = null; // { indice, sfondo, evidenza, scheda, tasti, riposiziona }

  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined) e.textContent = testo;
    return e;
  }

  function segnaVisto() {
    try { window.localStorage.setItem(CHIAVE, '1'); } catch (errore) { /* senza memoria del browser il giro ricompare: pazienza */ }
  }

  function giaVisto() {
    try { return window.localStorage.getItem(CHIAVE) === '1'; } catch (errore) { return false; }
  }

  function chiudi() {
    if (!stato) return;
    document.removeEventListener('keydown', stato.tasti);
    window.removeEventListener('resize', stato.riposiziona);
    window.removeEventListener('scroll', stato.riposiziona, true);
    stato.sfondo.remove();
    stato.evidenza.remove();
    stato.scheda.remove();
    stato = null;
    segnaVisto();
  }

  function visibile(e) {
    return e && e.getClientRects().length > 0;
  }

  function mostraPasso(indice) {
    var passo = PASSI[indice];
    stato.indice = indice;
    var bersaglio = passo.selettore ? document.querySelector(passo.selettore) : null;
    if (!visibile(bersaglio)) bersaglio = null;
    var scheda = stato.scheda;
    scheda.textContent = '';
    scheda.appendChild(el('div', 'giro-contatore', 'Passo ' + (indice + 1) + ' di ' + PASSI.length));
    scheda.appendChild(el('h3', null, passo.titolo));
    scheda.appendChild(el('p', null, passo.testo));
    var azioni = el('div', 'giro-azioni');
    var salta = el('button', 'secondario', indice === PASSI.length - 1 ? 'Chiudi' : 'Salta il giro');
    salta.type = 'button';
    salta.addEventListener('click', chiudi);
    azioni.appendChild(salta);
    if (indice > 0) {
      var indietro = el('button', 'secondario', '← Indietro');
      indietro.type = 'button';
      indietro.addEventListener('click', function () { mostraPasso(indice - 1); });
      azioni.appendChild(indietro);
    }
    if (indice < PASSI.length - 1) {
      var avanti = el('button', null, 'Avanti →');
      avanti.type = 'button';
      avanti.addEventListener('click', function () { mostraPasso(indice + 1); });
      azioni.appendChild(avanti);
    }
    scheda.appendChild(azioni);
    if (bersaglio && bersaglio.scrollIntoView) bersaglio.scrollIntoView({ block: 'center', behavior: 'auto' });
    stato.bersaglio = bersaglio;
    posiziona();
    var primo = scheda.querySelector('button:last-child');
    if (primo) primo.focus();
  }

  // Evidenzia il bersaglio (se c'è) e mette il fumetto sotto o sopra; senza bersaglio, al centro.
  function posiziona() {
    if (!stato) return;
    var b = stato.bersaglio;
    var scheda = stato.scheda;
    var evidenza = stato.evidenza;
    var larghezza = window.innerWidth;
    var altezza = window.innerHeight;
    if (!b || !visibile(b)) {
      evidenza.style.display = 'none';
      stato.sfondo.classList.add('giro-scuro');
      scheda.style.left = Math.max(12, (larghezza - Math.min(scheda.offsetWidth || 420, larghezza - 24)) / 2) + 'px';
      scheda.style.top = Math.max(12, (altezza - (scheda.offsetHeight || 240)) / 2) + 'px';
      return;
    }
    stato.sfondo.classList.remove('giro-scuro');
    var r = b.getBoundingClientRect();
    var margine = 6;
    evidenza.style.display = 'block';
    evidenza.style.left = (r.left - margine) + 'px';
    evidenza.style.top = (r.top - margine) + 'px';
    evidenza.style.width = (r.width + 2 * margine) + 'px';
    evidenza.style.height = (r.height + 2 * margine) + 'px';
    var h = scheda.offsetHeight || 240;
    var w = Math.min(scheda.offsetWidth || 420, larghezza - 24);
    var sotto = r.bottom + margine + 12;
    var top = sotto + h <= altezza - 8 ? sotto : Math.max(8, r.top - margine - 12 - h);
    var left = Math.min(Math.max(12, r.left), Math.max(12, larghezza - w - 12));
    scheda.style.top = top + 'px';
    scheda.style.left = left + 'px';
  }

  function avvia() {
    chiudi();
    var sfondo = el('div', 'giro-sfondo');
    var evidenza = el('div', 'giro-evidenza');
    var scheda = el('div', 'giro-scheda');
    scheda.setAttribute('role', 'dialog');
    scheda.setAttribute('aria-modal', 'true');
    scheda.setAttribute('aria-label', 'Guida passo passo');
    document.body.appendChild(sfondo);
    document.body.appendChild(evidenza);
    document.body.appendChild(scheda);
    var tasti = function (e) {
      if (e.key === 'Escape') chiudi();
      else if (e.key === 'ArrowRight' && stato && stato.indice < PASSI.length - 1) mostraPasso(stato.indice + 1);
      else if (e.key === 'ArrowLeft' && stato && stato.indice > 0) mostraPasso(stato.indice - 1);
    };
    stato = { indice: 0, sfondo: sfondo, evidenza: evidenza, scheda: scheda, tasti: tasti, riposiziona: posiziona, bersaglio: null };
    document.addEventListener('keydown', tasti);
    window.addEventListener('resize', posiziona);
    window.addEventListener('scroll', posiziona, true);
    mostraPasso(0);
  }

  // Parte da solo la prima volta; non parte se il browser è comandato da un programma di prova (le prove automatiche
  // non devono trovarsi un fumetto davanti).
  function daMostrare() {
    try { if (navigator.webdriver) return false; } catch (errore) { /* si procede */ }
    return !giaVisto();
  }

  window.CaiGiro = { avvia: avvia, chiudi: chiudi, giaVisto: giaVisto, daMostrare: daMostrare, aperto: function () { return Boolean(stato); } };
})();
