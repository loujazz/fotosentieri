// Pagina «Sentieri» degli amministratori: sincronizzazione con OSM2CAI e settori.
// - «Aggiorna ora» ripete i passi della sincronizzazione finché ha finito (ogni passo dura al massimo ~45 secondi).
// - I settori arrivano dal CAI solo con un codice (es. HBOE8): qui gli admin danno un nome comprensibile e
//   scelgono quali settori compaiono ai volontari.
(function () {
  'use strict';

  var MESSAGGI_ERRORE = {
    osm2cai_rallentato: 'Il sito del CAI ha chiesto di rallentare. Riprova tra qualche minuto: il lavoro già fatto non si perde.',
    osm2cai_errore: 'Il sito del CAI non risponde come previsto. Riprova più tardi.',
    osm2cai_non_trovato: 'Il sito del CAI non ha trovato un dato richiesto.',
    osm2cai_risposta: 'Il sito del CAI ha risposto con dati in un formato inatteso.',
    osm2cai_elenco_vuoto: 'Il sito del CAI ha restituito un elenco vuoto: per sicurezza si tengono i dati precedenti.',
    configurazione: 'C\'è un problema nella configurazione (scheda «configurazione» del foglio o variabili di Vercel).',
    errore_foglio: 'Non riesco a leggere o scrivere il foglio.',
    errore_drive: 'Non riesco a leggere o scrivere su Drive.',
    drive_pieno: 'Lo spazio su Drive è esaurito.',
    drive_limite: 'Drive è molto occupato: riprova tra qualche minuto.',
  };

  var MESSAGGI_API = {
    nome_troppo_lungo: 'Il nome è troppo lungo (al massimo 60 caratteri).',
    settore_non_trovato: 'Questo settore non esiste più. Ricarica la pagina.',
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

  function dataOra(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('it-IT') + ' alle ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  function pausa(ms) {
    return new Promise(function (risolvi) { setTimeout(risolvi, ms); });
  }

  function avvia(contenitore) {
    var stato = null;
    var impostazioni = null;
    var inEsecuzione = false;
    var annulla = false;

    contenitore.textContent = '';
    var titoloSync = el('h3', null, 'Sincronizzazione con il CAI');
    var rigaStato = el('p', 'messaggio');
    var avanzamento = el('div', 'avanzamento-sync');
    var barra = document.createElement('progress');
    barra.max = 1;
    var testoAvanzamento = el('div', 'nota');
    avanzamento.appendChild(barra);
    avanzamento.appendChild(testoAvanzamento);
    var errore = el('p', 'stato-lettura');
    errore.setAttribute('aria-live', 'polite');
    var pulsanteAggiorna = el('button', null, 'Aggiorna ora');
    pulsanteAggiorna.type = 'button';
    var notaSync = el('p', 'nota', 'Ogni notte i dati si aggiornano da soli. Se un aggiornamento non riesce, restano in uso quelli dell\'ultima volta. La prima volta può servire qualche minuto: lascia aperta questa pagina.');

    var titoloSettori = el('h3', null, 'Settori');
    var notaSettori = el('p', 'nota', 'I volontari vedono solo i settori attivi, con il nome che scrivi qui (se è vuoto, il codice del CAI). I settori nuovi compaiono dopo l\'aggiornamento: quelli che cominciano per HBO partono attivi, gli altri spenti.');
    var messaggioSettori = el('p', 'stato-lettura');
    messaggioSettori.setAttribute('aria-live', 'polite');
    var listaSettori = el('div', 'lista-settori');
    // ---- cerca un sentiero nei dati del CAI (per capire perché non compare ai volontari) ----
    var titoloCerca = el('h3', null, 'Cerca un sentiero');
    var notaCerca = el('p', 'nota', 'Scrivi il numero (per esempio 110) o parte del nome: la ricerca guarda in tutti i percorsi scaricati dal CAI, anche in quelli che i volontari non vedono, e dice perché un sentiero non compare nel menu.');
    var rigaCerca = el('div', 'riga-cerca');
    var campoCercaSent = document.createElement('input');
    campoCercaSent.type = 'search';
    campoCercaSent.autocomplete = 'off';
    campoCercaSent.placeholder = 'Numero o nome del sentiero';
    campoCercaSent.setAttribute('aria-label', 'Numero o nome del sentiero');
    var pulsanteCerca = el('button', null, 'Cerca');
    pulsanteCerca.type = 'button';
    rigaCerca.appendChild(campoCercaSent);
    rigaCerca.appendChild(pulsanteCerca);
    var esitoCerca = el('p', 'stato-lettura');
    esitoCerca.setAttribute('aria-live', 'polite');
    var risultatiCerca = el('div', 'risultati-cerca');

    var titoloComuni = el('h3', null, 'Sentieri per comune');
    var notaComuni = el('p', 'nota', 'Scegli un comune per vedere i sentieri che lo attraversano, come indicato dal CAI. Un sentiero che passa per più comuni compare in ciascuno. Si vedono solo i settori attivi.');
    var messaggioComuni = el('p', 'stato-lettura');
    messaggioComuni.setAttribute('aria-live', 'polite');
    var etichettaComune = el('label', 'campo-data');
    etichettaComune.appendChild(el('span', null, 'Comune'));
    var sceltaComune = document.createElement('select');
    etichettaComune.appendChild(sceltaComune);
    var etichettaCerca = el('label', 'campo-data');
    etichettaCerca.appendChild(el('span', null, 'Cerca per numero o nome (facoltativo)'));
    var cercaComune = document.createElement('input');
    cercaComune.type = 'search';
    cercaComune.autocomplete = 'off';
    etichettaCerca.appendChild(cercaComune);
    var elencoComune = el('div', 'lista-sentieri');
    var menu = null;
    var comuneScelto = '';
    [titoloSync, rigaStato, avanzamento, errore, pulsanteAggiorna, notaSync, titoloSettori, notaSettori, messaggioSettori, listaSettori,
      titoloCerca, notaCerca, rigaCerca, esitoCerca, risultatiCerca,
      titoloComuni, notaComuni, messaggioComuni, etichettaComune, etichettaCerca, elencoComune]
      .forEach(function (n) { contenitore.appendChild(n); });

    function messaggioErrore(e) {
      if (!e) return '';
      return (MESSAGGI_ERRORE[e.codice] || 'La sincronizzazione si è fermata per un problema (' + e.codice + ').') + (e.quando ? ' (' + dataOra(e.quando) + ')' : '');
    }

    function disegnaStato() {
      avanzamento.hidden = !stato || !stato.inCorso;
      if (!stato) { rigaStato.textContent = 'Sto controllando…'; return; }
      var c = stato.conteggi || {};
      rigaStato.textContent = stato.ultimaRiuscita
        ? 'Ultimo aggiornamento riuscito: ' + dataOra(stato.ultimaRiuscita) + ' · ' + (c.settori || 0) + ' settori, ' + (c.percorsi || 0) + ' percorsi.'
        : 'Non è ancora stata fatta nessuna sincronizzazione.';
      if (stato.inCorso) {
        var a = stato.avanzamento || { fatti: 0, totale: 0 };
        barra.value = a.totale ? a.fatti / a.totale : 0;
        testoAvanzamento.textContent = stato.descrizione + (a.totale ? ': ' + a.fatti + ' di ' + a.totale : '…');
      }
      errore.className = 'stato-lettura' + (stato.errore ? ' errore-testo' : '');
      errore.textContent = messaggioErrore(stato.errore) || (stato.saltati ? 'Attenzione: ' + stato.saltati + (stato.saltati === 1 ? ' elemento non si è potuto' : ' elementi non si sono potuti') + ' scaricare o salvare e restano come prima' + (stato.saltatiElenco && stato.saltatiElenco.length ? ' (' + stato.saltatiElenco.join(', ') + ')' : '') + '.' : '');
      pulsanteAggiorna.disabled = inEsecuzione;
      pulsanteAggiorna.textContent = inEsecuzione ? 'Aggiornamento in corso…' : (stato.inCorso ? 'Riprendi l\'aggiornamento' : 'Aggiorna ora');
    }

    async function chiamaSync(metodo, corpo) {
      var r = await window.CaiApi.chiedi('/api/admin/sync', corpo ? { method: metodo, body: corpo } : undefined);
      if (r.stato !== 200 || !r.corpo) throw new Error((r.corpo && r.corpo.errore) || 'generico');
      return r.corpo;
    }

    async function aggiorna() {
      if (inEsecuzione) return;
      inEsecuzione = true;
      annulla = false;
      errore.className = 'stato-lettura';
      errore.textContent = '';
      try {
        var tentativiOccupata = 0;
        for (;;) {
          stato = await chiamaSync('POST', {});
          disegnaStato();
          if (stato.errore || annulla) break;
          if (stato.occupata) {
            if (++tentativiOccupata > 12) break; // un altro passo (per esempio quello notturno) sta lavorando
            await pausa(5000);
            continue;
          }
          tentativiOccupata = 0;
          if (!stato.inCorso) break;
        }
      } catch (e) {
        errore.className = 'stato-lettura errore-testo';
        errore.textContent = MESSAGGI_API[e && e.message] || MESSAGGI_ERRORE[e && e.message] || MESSAGGI_API.generico;
      }
      inEsecuzione = false;
      disegnaStato();
      if (stato && !stato.inCorso) { caricaSettori(); caricaComuni(); }
    }

    // ---- cerca un sentiero ----
    async function cercaSentiero() {
      var q = campoCercaSent.value.trim();
      risultatiCerca.textContent = '';
      if (!q) { esitoCerca.className = 'stato-lettura avviso-testo'; esitoCerca.textContent = 'Scrivi un numero o un nome.'; return; }
      esitoCerca.className = 'stato-lettura';
      esitoCerca.textContent = 'Sto cercando…';
      var r;
      try {
        r = await window.CaiApi.chiedi('/api/admin/sentieri-cerca?q=' + encodeURIComponent(q));
      } catch (e) {
        esitoCerca.className = 'stato-lettura errore-testo';
        esitoCerca.textContent = MESSAGGI_API[e && e.message === 'sessione_scaduta' ? 'sessione_scaduta' : 'rete'];
        return;
      }
      if (r.stato !== 200 || !r.corpo) {
        esitoCerca.className = 'stato-lettura errore-testo';
        esitoCerca.textContent = MESSAGGI_API.generico;
        return;
      }
      var d = r.corpo;
      var sinc = d.sincronizzazione;
      esitoCerca.textContent = d.trovati.length === 0 ? '' : (d.trovati.length === 1 ? '1 sentiero trovato.' : d.trovati.length + ' sentieri trovati.');
      d.trovati.forEach(function (t) {
        var c = el('div', 'risultato-cerca ' + (t.visibile ? 'visibile' : 'nascosto'));
        c.appendChild(el('strong', null, (t.visibile ? '✅ ' : '⚠️ ') + t.ref + (t.nome ? ' – ' + t.nome : '')));
        if (t.da && t.a) c.appendChild(el('div', null, t.da + ' → ' + t.a));
        c.appendChild(el('div', 'nota', 'Comuni: ' + (t.comuni.length ? t.comuni.join(', ') : '—') + ' · Stato di accatastamento (SDA): ' + (t.sda === null ? '—' : t.sda) + ' · Codice interno: ' + t.id));
        c.appendChild(el('div', t.visibile ? 'nota' : 'avviso-testo', t.motivo));
        if (t.settori.length) {
          c.appendChild(el('div', 'nota', 'Settori: ' + t.settori.map(function (s) { return s.etichetta + (s.attivo ? ' (attivo)' : ' (spento)'); }).join(', ')));
        }
        risultatiCerca.appendChild(c);
      });
      if (d.trovati.length === 0) {
        var c0 = el('div', 'risultato-cerca nascosto');
        c0.appendChild(el('strong', null, '⚠️ «' + d.q + '» non c\'è nei dati scaricati dal CAI'));
        c0.appendChild(el('p', null, 'Può succedere se il percorso non è validato (stato di accatastamento ' + (sinc.sda || '4') + ') nel CAI, se sta fuori dall\'area che si scarica' + (sinc.area ? ' (' + sinc.area.join(', ') + ' = ovest, sud, est, nord)' : '') + ', se è stato saltato durante lo scarico, oppure se l\'ultimo aggiornamento è precedente alla sua validazione.'));
        c0.appendChild(el('div', 'nota', 'Ultimo aggiornamento riuscito: ' + (sinc.ultimaRiuscita ? dataOra(sinc.ultimaRiuscita) : 'mai') + ' · ' + sinc.percorsi + ' percorsi scaricati.'));
        if (sinc.saltati.length) c0.appendChild(el('div', 'avviso-testo', 'Elementi saltati nell\'ultimo scarico: ' + sinc.saltati.join('; ') + '.'));
        else c0.appendChild(el('div', 'nota', 'Nessun elemento saltato nell\'ultimo scarico.'));
        c0.appendChild(el('div', 'nota', 'Dopo aver controllato, premi «Aggiorna ora» in alto: se il percorso è stato validato da poco, comparirà.'));
        risultatiCerca.appendChild(c0);
      }
    }

    pulsanteCerca.addEventListener('click', cercaSentiero);
    campoCercaSent.addEventListener('keydown', function (e) { if (e.key === 'Enter') cercaSentiero(); });

    // ---- sentieri per comune ----
    function disegnaComuni() {
      sceltaComune.textContent = '';
      elencoComune.textContent = '';
      var conta = {};
      ((menu && menu.percorsi) || []).forEach(function (p) { p.comuni.forEach(function (c) { conta[c] = (conta[c] || 0) + 1; }); });
      var nomi = (menu && menu.comuni) || [];
      etichettaComune.hidden = etichettaCerca.hidden = nomi.length === 0;
      if (nomi.length === 0) {
        elencoComune.appendChild(el('p', 'messaggio', 'Nessun sentiero: fai prima «Aggiorna ora» e attiva i settori della sezione.'));
        return;
      }
      sceltaComune.appendChild(new Option('Scegli un comune…', ''));
      nomi.forEach(function (c) { sceltaComune.appendChild(new Option(c + ' (' + conta[c] + ')', c)); });
      sceltaComune.value = nomi.indexOf(comuneScelto) !== -1 ? comuneScelto : '';
      comuneScelto = sceltaComune.value;
      if (!comuneScelto) return;
      var trovati = window.CaiMenu.filtra(menu, { comune: comuneScelto, testo: cercaComune.value });
      elencoComune.appendChild(el('p', 'nota', trovati.length === 1 ? '1 sentiero.' : trovati.length + ' sentieri.'));
      var nomeDi = {};
      menu.settori.forEach(function (x) { nomeDi[x.id] = window.CaiMenu.nomeSettore(x); });
      trovati.forEach(function (p) {
        var r = el('div', 'sentiero');
        r.appendChild(el('strong', null, window.CaiMenu.testoSentiero(p)));
        var altri = p.comuni.filter(function (c) { return c !== comuneScelto; });
        var dettagli = ['Settore: ' + p.settori.map(function (id) { return nomeDi[id] || id; }).join(', ')];
        if (altri.length) dettagli.push('Passa anche per: ' + altri.join(', '));
        r.appendChild(el('div', 'nota', dettagli.join(' · ')));
        elencoComune.appendChild(r);
      });
    }

    async function caricaComuni() {
      try {
        var r = await window.CaiApi.chiedi('/api/sentieri');
        if (r.stato === 200 && r.corpo && Array.isArray(r.corpo.percorsi)) {
          menu = r.corpo;
          messaggioComuni.textContent = '';
        } else {
          messaggioComuni.className = 'stato-lettura errore-testo';
          messaggioComuni.textContent = MESSAGGI_API[r.corpo && r.corpo.errore] || MESSAGGI_API.generico;
        }
      } catch (e) {
        messaggioComuni.className = 'stato-lettura errore-testo';
        messaggioComuni.textContent = MESSAGGI_API.rete;
      }
      disegnaComuni();
    }

    sceltaComune.addEventListener('change', function () { comuneScelto = sceltaComune.value; disegnaComuni(); });
    cercaComune.addEventListener('input', disegnaComuni);

    // ---- settori ----
    function riga(s) {
      var r = el('div', 'settore' + (s.attivo ? '' : ' disattivata'));
      var codice = el('div', 'codice-settore');
      codice.appendChild(el('strong', null, s.codice));
      codice.appendChild(el('div', 'nota', s.percorsi === 1 ? '1 percorso' : s.percorsi + ' percorsi'));
      r.appendChild(codice);
      var etichetta = el('label', 'campo-descrizione nome-settore');
      etichetta.appendChild(el('span', null, 'Nome per i volontari'));
      var campo = document.createElement('input');
      campo.type = 'text';
      campo.maxLength = 60;
      campo.value = s.nome;
      campo.placeholder = 'Per esempio: Valle del Reno';
      var esito = el('span', 'nota esito-salvataggio');
      campo.addEventListener('change', function () {
        salva({ id: s.id, nome: campo.value }, esito);
      });
      etichetta.appendChild(campo);
      etichetta.appendChild(esito);
      r.appendChild(etichetta);
      var attivo = el('button', 'secondario piccolo', s.attivo ? 'Attivo' : 'Spento');
      attivo.type = 'button';
      attivo.setAttribute('aria-pressed', s.attivo ? 'true' : 'false');
      attivo.setAttribute('aria-label', (s.attivo ? 'Spegni ' : 'Attiva ') + s.codice);
      attivo.addEventListener('click', function () { salva({ id: s.id, attivo: !s.attivo }, esito); });
      r.appendChild(attivo);
      return r;
    }

    function disegnaSettori() {
      listaSettori.textContent = '';
      if (!impostazioni || impostazioni.settori.length === 0) {
        listaSettori.appendChild(el('p', 'messaggio', 'Nessun settore: fai prima «Aggiorna ora».'));
        return;
      }
      impostazioni.settori.forEach(function (s) { listaSettori.appendChild(riga(s)); });
    }

    async function caricaSettori() {
      try {
        var r = await window.CaiApi.chiedi('/api/admin/settori');
        if (r.stato === 200 && r.corpo) {
          impostazioni = r.corpo;
          messaggioSettori.textContent = '';
        } else {
          messaggioSettori.className = 'stato-lettura errore-testo';
          messaggioSettori.textContent = MESSAGGI_API[r.corpo && r.corpo.errore] || MESSAGGI_API.generico;
        }
      } catch (e) {
        messaggioSettori.className = 'stato-lettura errore-testo';
        messaggioSettori.textContent = MESSAGGI_API.rete;
      }
      disegnaSettori();
    }

    async function salva(corpo, esito) {
      esito.textContent = 'Salvo…';
      try {
        var r = await window.CaiApi.chiedi('/api/admin/settori', { method: 'POST', body: corpo });
        if (r.stato === 200 && r.corpo) {
          impostazioni = r.corpo;
          disegnaSettori();
          caricaComuni(); // attivare o spegnere un settore cambia i sentieri visibili
          return;
        }
        esito.className = 'nota esito-salvataggio avviso-testo';
        esito.textContent = MESSAGGI_API[r.corpo && r.corpo.errore] || MESSAGGI_API.generico;
      } catch (e) {
        esito.className = 'nota esito-salvataggio avviso-testo';
        esito.textContent = MESSAGGI_API.rete;
      }
    }

    pulsanteAggiorna.addEventListener('click', aggiorna);

    async function mostra() {
      disegnaStato();
      try {
        stato = await chiamaSync('GET');
      } catch (e) {
        errore.className = 'stato-lettura errore-testo';
        errore.textContent = MESSAGGI_API[e && e.message] || MESSAGGI_API.generico;
      }
      disegnaStato();
      await caricaSettori();
      await caricaComuni();
    }

    function azzera() {
      annulla = true;
      stato = null;
      impostazioni = null;
      menu = null;
      campoCercaSent.value = '';
      risultatiCerca.textContent = '';
      esitoCerca.textContent = '';
      comuneScelto = '';
      cercaComune.value = '';
      elencoComune.textContent = '';
      messaggioComuni.textContent = '';
      listaSettori.textContent = '';
      errore.textContent = '';
      messaggioSettori.textContent = '';
    }

    return { mostra: mostra, azzera: azzera };
  }

  window.Sentieri = { avvia: avvia };
})();
