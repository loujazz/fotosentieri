// Menu settore -> sentiero: filtri e testi, condivisi dalla pagina di caricamento e dalla sezione «Sentieri per comune».
// Il menu arriva da GET /api/sentieri: { settori: [{ id, codice, nome }], percorsi: [{ id, ref, nome, da, a, comuni, settori }], comuni }.
(function () {
  'use strict';

  function normalizza(testo) {
    return String(testo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  function nomeSettore(s) {
    return s.nome ? s.nome + ' (' + s.codice + ')' : s.codice;
  }

  function testoSentiero(p) {
    return [p.ref, p.nome ? '– ' + p.nome : '', p.da && p.a ? '(' + p.da + ' → ' + p.a + ')' : ''].filter(Boolean).join(' ');
  }

  // opzioni: { settore (id o null), comune (nome o ''), testo (ricerca per numero o nome) }
  function filtra(menu, opzioni) {
    var o = opzioni || {};
    var cerca = normalizza(o.testo);
    var risultato = (menu.percorsi || []).filter(function (p) {
      if (o.settore && p.settori.indexOf(o.settore) === -1) return false;
      if (o.comune && p.comuni.indexOf(o.comune) === -1) return false;
      if (!cerca) return true;
      return normalizza([p.ref, p.nome, p.da, p.a].join(' ')).indexOf(cerca) !== -1;
    });
    if (cerca) {
      // Prima i numeri che cominciano con quanto scritto (cercando «5», prima il 5 e il 50, poi il 105).
      risultato.sort(function (a, b) {
        var ia = normalizza(a.ref).indexOf(cerca) === 0 ? 0 : 1;
        var ib = normalizza(b.ref).indexOf(cerca) === 0 ? 0 : 1;
        return ia - ib;
      });
    }
    return risultato;
  }

  window.CaiMenu = { filtra: filtra, nomeSettore: nomeSettore, testoSentiero: testoSentiero, normalizza: normalizza };
})();
