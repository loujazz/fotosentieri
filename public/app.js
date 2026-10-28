// Pagina di accesso e scelta della vista. Nessun controllo di permesso qui:
// il browser mostra soltanto quello che il server (api/me) dichiara per l'utente.
(function () {
  'use strict';

  var tokenId = null; // ID token di Google, solo in memoria
  var configurazione = null;
  var caricamento = null; // controllo della vista "Carica foto" (creato al primo accesso di un volontario)

  var $ = function (id) { return document.getElementById(id); };
  var viste = ['caricamento', 'accesso', 'non-abilitato', 'errore', 'volontario', 'admin'];

  function mostra(nome) {
    viste.forEach(function (v) { $('vista-' + v).hidden = v !== nome; });
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

  function mostraAccesso() {
    tokenId = null;
    mostraUtente(null);
    mostra('accesso');
  }

  // Dopo l'accesso con Google: chiede al server chi sei e che ruolo hai.
  async function dopoAccesso(credenziale) {
    tokenId = credenziale.credential;
    mostra('caricamento');
    var r;
    try {
      r = await chiedi('/api/me', { headers: { Authorization: 'Bearer ' + tokenId } });
    } catch (e) {
      return mostraErrore('Connessione non riuscita. Controlla internet e riprova.');
    }

    if (r.stato === 200 && r.corpo) {
      mostraUtente(r.corpo.nome);
      if (r.corpo.ruolo === 'volontario') {
        if (!caricamento) caricamento = window.Carica.avvia($('carica-contenuto'));
        return mostra('volontario');
      }
      if (r.corpo.ruolo === 'admin' || r.corpo.ruolo === 'super_admin') {
        $('admin-ruolo').textContent = r.corpo.ruolo === 'super_admin' ? 'super amministratore' : 'amministratore';
        return mostra('admin');
      }
      return mostraErrore('Ruolo non riconosciuto. Avvisa un amministratore.');
    }

    var codice = r.corpo && r.corpo.errore;
    if (r.stato === 401) {
      return mostraAccesso(); // sessione scaduta o token non valido: nuovo accesso
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

  $('esci').addEventListener('click', esci);
  $('riprova').addEventListener('click', avvia);
  Array.prototype.forEach.call(document.querySelectorAll('.esci-vista'), function (b) {
    b.addEventListener('click', esci);
  });
  window.addEventListener('load', avvia);
})();
