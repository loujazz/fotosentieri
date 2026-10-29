// Dove scrivere per chiedere aiuto. Un solo posto: se cambia la persona o l'indirizzo, si modifica qui.
// Ogni elemento con l'attributo data-contatto diventa un collegamento «scrivi a …» (il testo scritto dentro resta
// come ripiego se questo file non si carica).
(function () {
  'use strict';

  var CONTATTO = {
    email: 'luigi.parisi@caibo.it',
    oggetto: 'Segnalazioni sentieri: richiesta di aiuto',
  };

  function riempi(radice) {
    Array.prototype.forEach.call((radice || document).querySelectorAll('[data-contatto]'), function (a) {
      a.textContent = CONTATTO.email;
      a.setAttribute('href', 'mailto:' + CONTATTO.email + '?subject=' + encodeURIComponent(CONTATTO.oggetto));
    });
  }

  window.CaiContatti = { email: CONTATTO.email, riempi: riempi };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { riempi(); });
  else riempi();
})();
