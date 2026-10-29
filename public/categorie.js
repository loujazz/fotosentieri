// Pagina «Categorie» degli amministratori: i tipi di problema tra cui i volontari scelgono.
// Si possono aggiungere, disattivare/riattivare e riordinare; non si cancellano né si rinominano
// (le foto già inviate le conservano). «Altro» c'è sempre e chiede al volontario di spiegare il problema.
(function () {
  'use strict';

  var MESSAGGI = {
    nome_non_valido: 'Il nome deve avere tra 2 e 40 caratteri.',
    nome_riservato: '«Altro» c\'è già sempre: non serve crearla.',
    categoria_esistente: 'Esiste già una categoria con questo nome (se è disattivata, riattivala dall\'elenco).',
    categoria_non_trovata: 'Questa categoria non esiste più. Ricarica la pagina.',
    rete: 'Connessione interrotta. Controlla internet e riprova.',
    sessione_scaduta: 'La sessione è scaduta: accedi di nuovo.',
    generico: 'Il servizio ha avuto un problema. Riprova tra poco.',
  };

  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined) e.textContent = testo;
    return e;
  }

  function pulsante(testo, classe, azione, etichettaAria) {
    var b = el('button', classe, testo);
    b.type = 'button';
    if (etichettaAria) b.setAttribute('aria-label', etichettaAria);
    b.addEventListener('click', azione);
    return b;
  }

  function avvia(contenitore) {
    var dati = null;
    var occupato = false;

    contenitore.textContent = '';
    contenitore.appendChild(el('p', 'messaggio', 'Sono i tipi di problema tra cui i volontari scelgono quando caricano le foto. Così tutti usano le stesse parole.'));
    var avviso = el('p', 'stato-lettura');
    avviso.setAttribute('aria-live', 'polite');
    var aggiunta = el('form', 'aggiunta-categoria');
    var etichettaCampo = el('label', 'campo-data');
    etichettaCampo.appendChild(el('span', null, 'Nuova categoria'));
    var campo = document.createElement('input');
    campo.type = 'text';
    campo.maxLength = 40;
    campo.placeholder = 'Per esempio: smottamento';
    etichettaCampo.appendChild(campo);
    var aggiungi = el('button', null, 'Aggiungi categoria');
    aggiungi.type = 'submit';
    aggiunta.appendChild(etichettaCampo);
    aggiunta.appendChild(aggiungi);
    var lista = el('div', 'lista-categorie');
    var notaAltro = el('p', 'nota');
    [aggiunta, avviso, lista, notaAltro].forEach(function (n) { contenitore.appendChild(n); });

    function errore(codice) {
      avviso.className = 'stato-lettura errore-testo';
      avviso.textContent = MESSAGGI[codice] || MESSAGGI.generico;
    }

    async function chiama(corpo) {
      if (occupato) return;
      occupato = true;
      disegna();
      avviso.className = 'stato-lettura';
      avviso.textContent = '';
      try {
        var r = corpo
          ? await window.CaiApi.chiedi('/api/admin/categorie', { method: 'POST', body: corpo })
          : await window.CaiApi.chiedi('/api/admin/categorie');
        if (r.stato === 200 && r.corpo && Array.isArray(r.corpo.categorie)) {
          dati = r.corpo;
          if (corpo && corpo.azione === 'aggiungi') campo.value = '';
        } else {
          errore(r.corpo && r.corpo.errore);
        }
      } catch (e) {
        errore(e && e.message === 'sessione_scaduta' ? 'sessione_scaduta' : 'rete');
      }
      occupato = false;
      disegna();
    }

    function riga(c, indice, totale) {
      var r = el('div', 'categoria' + (c.attiva ? '' : ' disattivata'));
      var nome = el('div', 'nome-categoria');
      nome.appendChild(el('strong', null, c.nome));
      nome.appendChild(el('div', 'nota', (c.attiva ? 'Attiva' : 'Disattivata, non compare ai volontari') + ' · ' + (c.usi === 1 ? '1 foto' : c.usi + ' foto')));
      r.appendChild(nome);
      var azioni = el('div', 'azioni-categoria');
      var su = pulsante('▲', 'secondario piccolo', function () { chiama({ azione: 'sposta', nome: c.nome, direzione: 'su' }); }, 'Sposta in alto ' + c.nome);
      var giu = pulsante('▼', 'secondario piccolo', function () { chiama({ azione: 'sposta', nome: c.nome, direzione: 'giu' }); }, 'Sposta in basso ' + c.nome);
      su.disabled = occupato || indice === 0;
      giu.disabled = occupato || indice === totale - 1;
      var attiva = pulsante(c.attiva ? 'Disattiva' : 'Riattiva', 'secondario piccolo', function () { chiama({ azione: 'attiva', nome: c.nome, attiva: !c.attiva }); });
      attiva.disabled = occupato;
      [su, giu, attiva].forEach(function (b) { azioni.appendChild(b); });
      r.appendChild(azioni);
      return r;
    }

    function disegna() {
      lista.textContent = '';
      aggiungi.disabled = occupato;
      if (!dati) return;
      if (dati.categorie.length === 0) lista.appendChild(el('p', 'messaggio', 'Non c\'è ancora nessuna categoria: aggiungine una qui sopra.'));
      dati.categorie.forEach(function (c, i) { lista.appendChild(riga(c, i, dati.categorie.length)); });
      notaAltro.textContent = '«' + dati.altro + '» compare sempre in fondo al menu e chiede al volontario di spiegare il problema nella nota' +
        (dati.usiAltro ? ' (' + (dati.usiAltro === 1 ? '1 foto' : dati.usiAltro + ' foto') + ' finora). ' : '. ') +
        'Se vedi spesso lo stesso problema in «Altro», crea una categoria apposta.';
    }

    aggiunta.addEventListener('submit', function (e) {
      e.preventDefault();
      var nome = campo.value.trim();
      if (!nome) { errore('nome_non_valido'); return; }
      chiama({ azione: 'aggiungi', nome: nome });
    });

    function azzera() {
      dati = null;
      occupato = false;
      campo.value = '';
      avviso.textContent = '';
      lista.textContent = '';
      notaAltro.textContent = '';
    }

    return { mostra: function () { return chiama(null); }, azzera: azzera };
  }

  window.Categorie = { avvia: avvia };
})();
