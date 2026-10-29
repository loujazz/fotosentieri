// Utenti e ruoli (solo super amministratore): elenco, nuovo utente, cambio di ruolo, attivazione e disattivazione.
// I permessi si controllano sul server (api/admin/utenti): questa pagina mostra solo ciò che la funzione restituisce.
(function () {
  'use strict';

  var NOMI_RUOLO = { volontario: 'Volontario', admin: 'Amministratore', super_admin: 'Super amministratore' };

  var MESSAGGI = {
    email_non_valida: 'L\'indirizzo email non è valido.',
    dominio_non_ammesso: 'Si possono abilitare solo indirizzi dell\'associazione (stesso dominio del tuo account).',
    utente_esistente: 'Questo indirizzo è già nell\'elenco.',
    utente_non_trovato: 'Questo utente non è più nell\'elenco. Ricarica la pagina.',
    ruolo_non_valido: 'Il ruolo scelto non è valido.',
    nome_troppo_lungo: 'Il nome è troppo lungo (al massimo 80 caratteri).',
    non_su_te_stesso: 'Non puoi cambiare il tuo ruolo né disattivarti: resteresti chiuso fuori. Chiedi a un altro super amministratore.',
    ultimo_super_admin: 'Deve restare almeno un super amministratore attivo.',
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

  function avvia(contenitore) {
    var dati = null;
    var io = null; // email di chi è collegato (non si può modificare se stessi)

    contenitore.textContent = '';
    var titolo = el('h3', null, 'Utenti e ruoli');
    var nota = el('p', 'nota', 'Chi non è in questo elenco, o è disattivato, non può entrare. Il volontario carica foto; l\'amministratore le rivede e vede la mappa; il super amministratore gestisce anche gli utenti. Gli utenti non si cancellano: si disattivano, e la disattivazione vale subito.');
    var esito = el('p', 'stato-lettura');
    esito.setAttribute('aria-live', 'polite');

    var nuovo = el('div', 'nuovo-utente');
    nuovo.appendChild(el('h4', null, 'Aggiungi un utente'));
    var campoEmail = document.createElement('input');
    campoEmail.type = 'email';
    campoEmail.autocomplete = 'off';
    campoEmail.placeholder = 'nome.cognome@…';
    var campoNome = document.createElement('input');
    campoNome.type = 'text';
    campoNome.maxLength = 80;
    campoNome.placeholder = 'Nome e cognome (facoltativo)';
    var campoRuolo = document.createElement('select');
    [['volontario', 'Volontario'], ['admin', 'Amministratore'], ['super_admin', 'Super amministratore']].forEach(function (r) { campoRuolo.appendChild(new Option(r[1], r[0])); });
    var aggiungi = el('button', null, 'Aggiungi');
    aggiungi.type = 'button';
    [['Indirizzo email', campoEmail], ['Nome', campoNome], ['Ruolo', campoRuolo]].forEach(function (c) {
      var e = el('label', 'campo-data');
      e.appendChild(el('span', null, c[0]));
      e.appendChild(c[1]);
      nuovo.appendChild(e);
    });
    nuovo.appendChild(aggiungi);

    var cerca = el('label', 'campo-data');
    cerca.appendChild(el('span', null, 'Cerca un utente'));
    var campoCerca = document.createElement('input');
    campoCerca.type = 'search';
    campoCerca.autocomplete = 'off';
    cerca.appendChild(campoCerca);
    var conteggio = el('p', 'nota');
    var elenco = el('div', 'lista-utenti');
    [titolo, nota, esito, nuovo, cerca, conteggio, elenco].forEach(function (n) { contenitore.appendChild(n); });

    function errore(codice) {
      esito.className = 'stato-lettura errore-testo';
      esito.textContent = MESSAGGI[codice] || MESSAGGI.generico;
    }

    async function chiama(corpo) {
      var r;
      try {
        r = await window.CaiApi.chiedi('/api/admin/utenti', corpo ? { method: 'POST', body: corpo } : undefined);
      } catch (e) {
        errore(e && e.message === 'sessione_scaduta' ? 'sessione_scaduta' : 'rete');
        return false;
      }
      if (r.stato !== 200 || !r.corpo) {
        errore(r.corpo && r.corpo.errore);
        return false;
      }
      dati = r.corpo;
      return true;
    }

    function riga(u) {
      var sono_io = u.email === io;
      var r = el('div', 'riga-utente' + (u.attivo ? '' : ' disattivata'));
      var chi = el('div', 'chi');
      chi.appendChild(el('strong', null, u.nome || u.email));
      if (u.nome) chi.appendChild(el('div', 'nota', u.email));
      if (sono_io) chi.appendChild(el('div', 'nota', '(sei tu)'));
      chi.appendChild(el('div', 'nota', 'Ultimo accesso: ' + (dataOra(u.ultimoAccesso) || 'non registrato')));
      chi.appendChild(el('div', 'nota', u.invii === 0 ? 'Nessun invio' : (u.invii === 1 ? '1 invio' : u.invii + ' invii') + ' · ' + (u.foto === 1 ? '1 foto' : u.foto + ' foto')));
      r.appendChild(chi);

      var ruolo = el('label', 'campo-descrizione');
      ruolo.appendChild(el('span', null, 'Ruolo'));
      var sel = document.createElement('select');
      if (!u.ruolo) sel.appendChild(new Option('Ruolo non valido', ''));
      dati.ruoli.forEach(function (x) { sel.appendChild(new Option(NOMI_RUOLO[x] || x, x)); });
      sel.value = u.ruolo;
      sel.disabled = sono_io;
      sel.addEventListener('change', async function () {
        var scelto = sel.value;
        if (scelto === 'super_admin' && !window.confirm('Rendere ' + (u.nome || u.email) + ' super amministratore? Potrà gestire utenti e ruoli.')) { sel.value = u.ruolo; return; }
        if (u.ruolo === 'super_admin' && !window.confirm('Togliere a ' + (u.nome || u.email) + ' il ruolo di super amministratore?')) { sel.value = u.ruolo; return; }
        await modifica({ azione: 'modifica', email: u.email, ruolo: scelto }, '✅ Ruolo cambiato per ' + (u.nome || u.email) + ': ' + (NOMI_RUOLO[scelto] || scelto) + '.');
      });
      ruolo.appendChild(sel);
      r.appendChild(ruolo);

      var attivo = el('button', 'secondario piccolo', u.attivo ? 'Attivo' : 'Disattivato');
      attivo.type = 'button';
      attivo.disabled = sono_io;
      attivo.setAttribute('aria-pressed', u.attivo ? 'true' : 'false');
      attivo.setAttribute('aria-label', (u.attivo ? 'Disattiva ' : 'Riattiva ') + (u.nome || u.email));
      attivo.addEventListener('click', async function () {
        if (u.attivo && !window.confirm('Disattivare ' + (u.nome || u.email) + '? Non potrà più entrare finché non lo riattivi.')) return;
        await modifica({ azione: 'modifica', email: u.email, attivo: !u.attivo }, u.attivo ? '✅ ' + (u.nome || u.email) + ' è stato disattivato.' : '✅ ' + (u.nome || u.email) + ' è di nuovo attivo.');
      });
      r.appendChild(attivo);
      return r;
    }

    function disegna() {
      elenco.textContent = '';
      if (!dati) return;
      var testo = window.CaiMenu ? window.CaiMenu.normalizza(campoCerca.value) : campoCerca.value.toLowerCase();
      var norm = function (t) { return window.CaiMenu ? window.CaiMenu.normalizza(t) : String(t).toLowerCase(); };
      var visibili = dati.utenti.filter(function (u) { return !testo || norm(u.nome + ' ' + u.email).indexOf(testo) !== -1; });
      conteggio.textContent = dati.utenti.length === 1 ? '1 utente.' : dati.utenti.length + ' utenti' + (testo ? ', ' + visibili.length + ' trovati.' : '.');
      visibili.forEach(function (u) { elenco.appendChild(riga(u)); });
      campoEmail.placeholder = 'nome.cognome@' + dati.dominio;
    }

    async function modifica(corpo, ok) {
      esito.className = 'stato-lettura';
      esito.textContent = 'Un momento…';
      if (await chiama(corpo)) {
        esito.className = 'stato-lettura stato-inviata';
        esito.textContent = ok;
      }
      disegna(); // anche in caso di errore: i menu tornano al valore vero
    }

    aggiungi.addEventListener('click', async function () {
      var email = campoEmail.value.trim();
      if (!email) { errore('email_non_valida'); campoEmail.focus(); return; }
      aggiungi.disabled = true;
      await modifica({ azione: 'aggiungi', email: email, nome: campoNome.value, ruolo: campoRuolo.value }, '✅ Utente aggiunto: ' + email + '. Può entrare subito con il suo account.');
      if (esito.className.indexOf('stato-inviata') !== -1) { campoEmail.value = ''; campoNome.value = ''; campoRuolo.value = 'volontario'; }
      aggiungi.disabled = false;
    });
    campoCerca.addEventListener('input', disegna);

    async function mostra() {
      esito.className = 'stato-lettura';
      esito.textContent = 'Sto caricando gli utenti…';
      try {
        var me = await window.CaiApi.chiedi('/api/me');
        io = me.corpo && me.corpo.email;
      } catch (e) { io = null; }
      if (await chiama()) esito.textContent = '';
      disegna();
    }

    function azzera() {
      dati = null;
      elenco.textContent = '';
      esito.textContent = '';
      conteggio.textContent = '';
      campoCerca.value = '';
      campoEmail.value = '';
      campoNome.value = '';
    }

    return { mostra: mostra, azzera: azzera };
  }

  window.Utenti = { avvia: avvia };
})();
