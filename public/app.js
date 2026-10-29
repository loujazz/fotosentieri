// Pagina di accesso e scelta della vista. Nessun controllo di permesso qui:
// il browser mostra soltanto quello che il server (api/me) dichiara per l'utente.
(function () {
  'use strict';

  var sessione = null; // { token, scade }: biglietto di sessione del sito, solo in memoria
  var rinnovo = null; // rinnovo in corso, condiviso tra chiamate contemporanee
  var configurazione = null;
  var pannello = null; // controllo della dashboard degli amministratori
  var mappa = null; // controllo della mappa (amministratori)
  var caricamento = null; // controllo della vista "Carica foto" (creato al primo accesso di un volontario)

  var $ = function (id) { return document.getElementById(id); };
  var viste = ['caricamento', 'accesso', 'non-abilitato', 'errore', 'volontario', 'admin'];

  function mostra(nome) {
    viste.forEach(function (v) { $('vista-' + v).hidden = v !== nome; });
    document.body.classList.toggle('largo', nome === 'admin'); // la dashboard usa più spazio
  }

  function mostraErrore(testo) {
    $('errore-testo').textContent = testo;
    mostra('errore');
  }

  function mostraUtente(nome) {
    $('utente-nome').textContent = nome || '';
    $('utente').hidden = !nome;
  }

  async function chiedi(url, opzioni) {
    var risposta = await fetch(url, opzioni);
    var corpo = null;
    try { corpo = await risposta.json(); } catch (e) { /* corpo non JSON */ }
    return { stato: risposta.status, corpo: corpo };
  }

  async function caricaConfigurazione() {
    var r = await chiedi('/api/me?config=1');
    if (r.stato !== 200 || !r.corpo || !r.corpo.clientId) {
      throw new Error('Il servizio non è configurato correttamente. Avvisa un amministratore.');
    }
    configurazione = r.corpo;
    $('dominio-testo').textContent = '@' + configurazione.dominio;
  }

  function aspettaGoogle() {
    return new Promise(function (risolvi, rifiuta) {
      var tentativi = 0;
      (function controlla() {
        if (window.google && window.google.accounts && window.google.accounts.id) return risolvi();
        if (++tentativi > 100) return rifiuta(new Error('Impossibile contattare Google. Controlla la connessione e riprova.'));
        setTimeout(controlla, 100);
      })();
    });
  }

  function mostraAccesso(avviso) {
    sessione = null;
    mostraUtente(null);
    $('accesso-avviso').textContent = avviso || '';
    $('accesso-avviso').hidden = !avviso;
    mostra('accesso');
  }

  // Sessione scaduta o non più valida: nuovo accesso con Google. Le foto già scelte restano in elenco.
  function sessioneScaduta() {
    mostraAccesso('La sessione è scaduta. Accedi di nuovo: le foto che hai scelto restano in elenco.');
  }

  // Rinnova il biglietto di sessione quando mancano meno di 2 ore alla scadenza.
  async function assicuraSessione() {
    if (!sessione) throw new Error('nessuna_sessione');
    if (sessione.scade - Date.now() / 1000 > 2 * 60 * 60) return;
    if (!rinnovo) {
      rinnovo = chiedi('/api/sessione', { method: 'POST', headers: { Authorization: 'Bearer ' + sessione.token } })
        .then(function (r) {
          if (r.stato === 200 && r.corpo && r.corpo.sessione) {
            sessione = { token: r.corpo.sessione, scade: r.corpo.scade };
          }
          return r;
        })
        .finally(function () { rinnovo = null; });
    }
    var r = await rinnovo;
    if (r.stato === 401) {
      sessioneScaduta();
      throw new Error('sessione_scaduta');
    }
    // Un guasto passeggero del rinnovo non blocca: il biglietto attuale vale ancora.
  }

  // Chiamata alle funzioni del server con il biglietto di sessione. Restituisce { stato, corpo }.
  // opzioni: { method, body } (body è un oggetto, spedito come JSON).
  async function chiediAlServer(url, opzioni) {
    await assicuraSessione();
    var o = opzioni || {};
    var risposta = await chiedi(url, {
      method: o.method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + sessione.token }, o.body ? { 'Content-Type': 'application/json' } : {}),
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    if (risposta.stato === 401) sessioneScaduta();
    return risposta;
  }
  // Come chiediAlServer ma per file (miniature): restituisce il Blob oppure lancia un errore con "stato".
  async function bloccoDalServer(url) {
    await assicuraSessione();
    var risposta = await fetch(url, { headers: { Authorization: 'Bearer ' + sessione.token } });
    if (risposta.status === 401) sessioneScaduta();
    if (!risposta.ok) {
      var errore = new Error('http_' + risposta.status);
      errore.stato = risposta.status;
      throw errore;
    }
    return risposta.blob();
  }
  window.CaiApi = { chiedi: chiediAlServer, blob: bloccoDalServer };

  // Sezioni della vista admin: "foto" (dashboard) e "mappa". Ogni volta si ricarica l'elenco.
  function mostraSezioneAdmin(nome) {
    $('sezione-foto').hidden = nome !== 'foto';
    $('sezione-mappa').hidden = nome !== 'mappa';
    Array.prototype.forEach.call(document.querySelectorAll('#admin-navigazione button'), function (b) {
      b.classList.toggle('attiva', b.getAttribute('data-sezione') === nome);
    });
    return nome === 'mappa' ? mappa.mostra() : pannello.ricarica();
  }

  // Dopo l'accesso con Google: il server verifica l'ID token, controlla il foglio e rilascia
  // il biglietto di sessione con ruolo e nome.
  async function dopoAccesso(credenziale) {
    var tokenId = credenziale.credential;
    mostra('caricamento');
    var r;
    try {
      r = await chiedi('/api/sessione', { method: 'POST', headers: { Authorization: 'Bearer ' + tokenId } });
    } catch (e) {
      return mostraErrore('Connessione non riuscita. Controlla internet e riprova.');
    }

    if (r.stato === 200 && r.corpo && r.corpo.sessione) {
      sessione = { token: r.corpo.sessione, scade: r.corpo.scade };
      mostraUtente(r.corpo.nome);
      if (r.corpo.ruolo === 'volontario') {
        if (!caricamento) caricamento = window.Carica.avvia($('carica-contenuto'));
        return mostra('volontario');
      }
      if (r.corpo.ruolo === 'admin' || r.corpo.ruolo === 'super_admin') {
        $('admin-ruolo').textContent = r.corpo.ruolo === 'super_admin' ? 'super amministratore' : 'amministratore';
        if (!pannello) pannello = window.Dashboard.avvia($('dashboard-contenuto'));
        if (!mappa) mappa = window.Mappa.avvia($('mappa-contenuto'));
        mostra('admin');
        return mostraSezioneAdmin('foto');
      }
      return mostraErrore('Ruolo non riconosciuto. Avvisa un amministratore.');
    }

    var codice = r.corpo && r.corpo.errore;
    if (r.stato === 401) {
      return mostraAccesso(); // token di Google non valido o scaduto: nuovo accesso
    }
    if (codice === 'non_abilitato') {
      $('non-abilitato-email').textContent = emailDaToken(tokenId);
      mostraUtente(null);
      return mostra('non-abilitato');
    }
    if (codice === 'dominio_non_ammesso') {
      return mostraErrore('Puoi entrare solo con un account @' + configurazione.dominio + '. Esci e usa quello giusto.');
    }
    return mostraErrore('Il servizio ha avuto un problema (' + (codice || r.stato) + '). Riprova tra poco; se continua, avvisa un amministratore.');
  }

  // Solo per mostrare l'indirizzo nel messaggio: non è un controllo di sicurezza.
  function emailDaToken(token) {
    try {
      var parte = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(parte)).email || '';
    } catch (e) {
      return '';
    }
  }

  function esci() {
    if (caricamento) caricamento.azzera();
    if (pannello) pannello.azzera();
    if (mappa) mappa.azzera();
    if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect();
    mostraAccesso();
  }

  async function avvia() {
    mostra('caricamento');
    try {
      await caricaConfigurazione();
      await aspettaGoogle();
    } catch (e) {
      return mostraErrore(e.message);
    }
    window.google.accounts.id.initialize({
      client_id: configurazione.clientId,
      hd: configurazione.dominio,
      callback: dopoAccesso,
      auto_select: true,
    });
    window.google.accounts.id.renderButton($('pulsante-google'), {
      theme: 'filled_blue',
      size: 'large',
      text: 'signin_with',
      locale: 'it',
      width: 300,
    });
    mostraAccesso();
    // Se l'utente ha già un accesso valido, Google lo riconosce senza altri click
    // e fornisce un nuovo token anche dopo la scadenza di quello precedente.
    window.google.accounts.id.prompt();
  }

  Array.prototype.forEach.call(document.querySelectorAll('#admin-navigazione button'), function (b) {
    b.addEventListener('click', function () { mostraSezioneAdmin(b.getAttribute('data-sezione')); });
  });
  $('esci').addEventListener('click', esci);
  $('riprova').addEventListener('click', avvia);
  Array.prototype.forEach.call(document.querySelectorAll('.esci-vista'), function (b) {
    b.addEventListener('click', esci);
  });
  window.addEventListener('load', avvia);
})();
