// «I miei invii» (volontari): gli invii fatti, con lo stato di ogni foto (in attesa, approvata, rifiutata e motivo).
// Legge GET /api/miei-invii, che restituisce solo gli invii di chi è collegato.
(function () {
  'use strict';

  var STATI = {
    in_attesa: { icona: '⏳', testo: 'In attesa di revisione' },
    approvata: { icona: '✅', testo: 'Approvata' },
    rifiutata: { icona: '❌', testo: 'Rifiutata' },
  };

  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined) e.textContent = testo;
    return e;
  }

  function soloData(testo) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(testo || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('it-IT') : '';
  }

  function dataOra(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('it-IT') + ' alle ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  function riassunto(c) {
    return [
      c.in_attesa ? c.in_attesa + (c.in_attesa === 1 ? ' in attesa' : ' in attesa') : '',
      c.approvata ? c.approvata + (c.approvata === 1 ? ' approvata' : ' approvate') : '',
      c.rifiutata ? c.rifiutata + (c.rifiutata === 1 ? ' rifiutata' : ' rifiutate') : '',
    ].filter(Boolean).join(' · ') || 'nessuna foto registrata';
  }

  function avvia(contenitore) {
    contenitore.textContent = '';
    var stato = el('p', 'stato-lettura');
    stato.setAttribute('aria-live', 'polite');
    var elenco = el('div', 'lista-invii');
    var aggiorna = el('button', 'secondario', 'Aggiorna l\'elenco');
    aggiorna.type = 'button';
    [stato, aggiorna, elenco].forEach(function (n) { contenitore.appendChild(n); });

    function schedaFoto(f) {
      var r = el('div', 'foto-invio foto-' + f.stato);
      var s = STATI[f.stato] || STATI.in_attesa;
      r.appendChild(el('strong', 'nome-foto', f.nomeFile));
      r.appendChild(el('div', null, s.icona + ' ' + s.testo));
      if (f.stato === 'rifiutata') r.appendChild(el('div', 'avviso-testo', f.motivoRifiuto ? 'Motivo: ' + f.motivoRifiuto : 'Motivo non indicato.'));
      var descrizione = [f.etichetta ? '🏷️ ' + f.etichetta : '', f.nota ? '💬 ' + f.nota : ''].filter(Boolean).join(' · ');
      if (descrizione) r.appendChild(el('div', 'nota', descrizione));
      if (f.senzaPosizione) r.appendChild(el('div', 'nota avviso-testo', '⚠️ Senza posizione: non può comparire sulla mappa.'));
      return r;
    }

    function schedaInvio(i, aperta) {
      var d = el('details', 'invio');
      if (aperta) d.open = true;
      var titolo = el('summary');
      titolo.appendChild(el('strong', null, 'Sopralluogo del ' + (soloData(i.dataSopralluogo) || 'data non indicata')));
      titolo.appendChild(el('div', 'nota', 'Inviato il ' + (dataOra(i.dataInvio) || '—') + ' · ' + riassunto(i.conteggi)));
      d.appendChild(titolo);
      var dove = [i.settore ? 'Settore ' + i.settore : '', i.sentiero ? 'Sentiero ' + i.sentiero : ''].filter(Boolean).join(' · ');
      if (dove) d.appendChild(el('div', 'nota', '🥾 ' + dove));
      if (i.foto.length === 0) d.appendChild(el('p', 'nota', 'Nessuna foto registrata per questo invio.'));
      i.foto.forEach(function (f) { d.appendChild(schedaFoto(f)); });
      return d;
    }

    async function carica() {
      stato.className = 'stato-lettura';
      stato.textContent = 'Sto caricando i tuoi invii…';
      var r;
      try {
        r = await window.CaiApi.chiedi('/api/miei-invii');
      } catch (errore) {
        stato.className = 'stato-lettura errore-testo';
        stato.textContent = errore && errore.message === 'sessione_scaduta' ? 'La sessione è scaduta: accedi di nuovo.' : 'Connessione interrotta. Controlla internet e riprova.';
        return;
      }
      if (r.stato !== 200 || !r.corpo) {
        stato.className = 'stato-lettura errore-testo';
        stato.textContent = 'Non riesco a caricare i tuoi invii. Riprova tra poco; se continua, avvisa un amministratore.';
        return;
      }
      elenco.textContent = '';
      var dati = r.corpo;
      stato.textContent = dati.totale === 0 ? 'Non hai ancora inviato foto.' :
        (dati.totale === 1 ? 'Hai fatto 1 invio.' : 'Hai fatto ' + dati.totale + ' invii.') + (dati.totale > dati.limite ? ' Si vedono i ' + dati.limite + ' più recenti.' : '');
      dati.invii.forEach(function (i, n) { elenco.appendChild(schedaInvio(i, n === 0)); });
    }

    aggiorna.addEventListener('click', carica);

    return {
      mostra: carica,
      azzera: function () { elenco.textContent = ''; stato.textContent = ''; },
    };
  }

  window.MieiInvii = { avvia: avvia };
})();
