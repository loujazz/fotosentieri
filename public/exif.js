// Lettore dei metadati di una foto (posizione GPS, data di scatto, fotocamera).
// Legge JPEG (Android) e HEIC (iPhone) direttamente nel browser, senza librerie e senza
// caricare nulla: legge solo le parti iniziali del file che contengono i metadati.
//
// Uso:   const r = await CaiExif.leggi(file);
// Risultato (sempre un oggetto, non lancia eccezioni per file illeggibili):
//   formato     'jpeg' | 'heic' | 'altro'
//   exif        true se il file contiene metadati EXIF
//   lat, lon    gradi decimali, oppure null se la posizione manca
//   quota       metri (negativa sotto il livello del mare), oppure null
//   gpsZero     true se il blocco GPS c'è ma le coordinate sono 0,0 (posizione non valida)
//   dataScatto  "AAAA-MM-GGTHH:MM:SS" (ora locale del telefono, senza fuso) oppure null
//   marca, modello
//   errore      testo dell'errore se il file è danneggiato o non si è potuto leggere, altrimenti null
(function (radice, fabbrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabbrica();
  else radice.CaiExif = fabbrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LUNGHEZZA_TESTA = 1024 * 1024; // il JPEG tiene l'EXIF all'inizio; l'HEIC la tabella degli elementi
  var MAX_META = 16 * 1024 * 1024; // difesa contro dimensioni assurde nel file
  var MAX_EXIF = 4 * 1024 * 1024;
  var DIMENSIONE_TIPO = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  var MARCHE_HEIC = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif'];

  function nuovoRisultato(formato) {
    return {
      formato: formato, exif: false, lat: null, lon: null, quota: null, gpsZero: false,
      dataScatto: null, marca: null, modello: null, errore: null,
    };
  }

  function testo(dv, pos, n) {
    var s = '';
    for (var i = 0; i < n; i++) {
      var c = dv.getUint8(pos + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  function quattro(dv, pos) {
    return String.fromCharCode(dv.getUint8(pos), dv.getUint8(pos + 1), dv.getUint8(pos + 2), dv.getUint8(pos + 3));
  }

  // "2026:10:28 12:30:05" -> "2026-10-28T12:30:05"
  function dataIso(s) {
    var m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
    if (!m || m[1] === '0000') return null;
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
  }

  // ---- EXIF (formato TIFF), comune a JPEG e HEIC ----
  function leggiTiff(dv, inizio, risultato) {
    var marcatore = dv.getUint16(inizio);
    if (marcatore !== 0x4949 && marcatore !== 0x4D4D) throw new Error('intestazione EXIF non valida');
    var little = marcatore === 0x4949;
    if (dv.getUint16(inizio + 2, little) !== 42) throw new Error('intestazione EXIF non valida');
    var u16 = function (p) { return dv.getUint16(p, little); };
    var u32 = function (p) { return dv.getUint32(p, little); };

    function leggiIfd(rel) {
      var base = inizio + rel;
      var n = u16(base);
      if (base + 2 + n * 12 > dv.byteLength) throw new Error('EXIF troncato');
      var voci = {};
      for (var i = 0; i < n; i++) {
        var o = base + 2 + i * 12;
        var tag = u16(o), tipo = u16(o + 2), quanti = u32(o + 4);
        var dim = (DIMENSIONE_TIPO[tipo] || 1) * quanti;
        var pos = dim <= 4 ? o + 8 : inizio + u32(o + 8);
        voci[tag] = { tipo: tipo, quanti: quanti, pos: pos, dim: dim };
      }
      return voci;
    }
    function controlla(v) {
      if (v.pos + v.dim > dv.byteLength) throw new Error('EXIF troncato');
      return v;
    }
    function ascii(v) { return v ? testo(dv, controlla(v).pos, v.quanti) : null; }
    function razionali(v) {
      controlla(v);
      var r = [];
      for (var i = 0; i < v.quanti; i++) {
        var num = u32(v.pos + i * 8), den = u32(v.pos + i * 8 + 4);
        r.push(den ? num / den : NaN);
      }
      return r;
    }
    function gradi(a) { return a[0] + (a[1] || 0) / 60 + (a[2] || 0) / 3600; }

    risultato.exif = true;
    var ifd0 = leggiIfd(u32(inizio + 4));
    risultato.marca = (ascii(ifd0[0x010F]) || '').trim() || null;
    risultato.modello = (ascii(ifd0[0x0110]) || '').trim() || null;
    var data = null;
    if (ifd0[0x8769]) {
      var ifdExif = leggiIfd(u32(ifd0[0x8769].pos));
      data = dataIso(ascii(ifdExif[0x9003])) || dataIso(ascii(ifdExif[0x9004]));
    }
    risultato.dataScatto = data || dataIso(ascii(ifd0[0x0132]));

    if (ifd0[0x8825]) {
      var gps = leggiIfd(u32(ifd0[0x8825].pos));
      if (gps[2] && gps[4]) {
        var lat = gradi(razionali(gps[2]));
        var lon = gradi(razionali(gps[4]));
        if ((ascii(gps[1]) || 'N').charAt(0).toUpperCase() === 'S') lat = -lat;
        if ((ascii(gps[3]) || 'E').charAt(0).toUpperCase() === 'W') lon = -lon;
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          throw new Error('coordinate GPS non valide');
        }
        if (lat === 0 && lon === 0) {
          risultato.gpsZero = true;
        } else {
          risultato.lat = lat;
          risultato.lon = lon;
          if (gps[6]) {
            var quota = razionali(gps[6])[0];
            if (isFinite(quota)) {
              var sotto = gps[5] && dv.getUint8(controlla(gps[5]).pos) === 1;
              risultato.quota = sotto ? -quota : quota;
            }
          }
        }
      }
    }
  }

  // ---- JPEG ----
  function leggiJpeg(dv) {
    var r = nuovoRisultato('jpeg');
    var p = 2;
    while (p + 4 <= dv.byteLength) {
      if (dv.getUint8(p) !== 0xFF) break;
      var marcatore = dv.getUint8(p + 1);
      if (marcatore === 0xFF) { p += 1; continue; } // byte di riempimento
      if (marcatore === 0xD8 || marcatore === 0x01 || (marcatore >= 0xD0 && marcatore <= 0xD7)) { p += 2; continue; }
      if (marcatore === 0xDA || marcatore === 0xD9) break; // dati dell'immagine: i metadati sono finiti
      var lunghezza = dv.getUint16(p + 2);
      if (marcatore === 0xE1 && p + 10 <= dv.byteLength && testo(dv, p + 4, 4) === 'Exif') {
        if (p + 2 + lunghezza > dv.byteLength) throw new Error('EXIF troncato');
        leggiTiff(dv, p + 10, r);
        return r;
      }
      p += 2 + lunghezza;
    }
    return r; // JPEG senza EXIF
  }

  // ---- HEIC (contenitore ISO a "scatole") ----
  function scatole(dv, inizio, fine) {
    var elenco = [];
    var p = inizio;
    while (p + 8 <= fine) {
      var dimensione = dv.getUint32(p);
      var tipo = quattro(dv, p + 4);
      var testata = 8;
      if (dimensione === 1) {
        if (p + 16 > fine) break;
        dimensione = Number(dv.getBigUint64(p + 8));
        testata = 16;
      } else if (dimensione === 0) {
        dimensione = fine - p;
      }
      if (dimensione < testata) break;
      elenco.push({ tipo: tipo, inizio: p, corpo: p + testata, fine: Math.min(p + dimensione, fine), dimensione: dimensione, troncata: p + dimensione > fine });
      p += dimensione;
    }
    return elenco;
  }

  function trovaScatola(elenco, tipo) {
    for (var i = 0; i < elenco.length; i++) if (elenco[i].tipo === tipo) return elenco[i];
    return null;
  }

  function leggiN(dv, pos, n) {
    if (n === 0) return 0;
    if (n === 4) return dv.getUint32(pos);
    if (n === 8) return Number(dv.getBigUint64(pos));
    throw new Error('HEIC con dimensioni non supportate');
  }

  // Identificativo dell'elemento "Exif" dalla tabella iinf.
  function idElementoExif(dv, meta) {
    var iinf = trovaScatola(scatole(dv, meta.corpo + 4, meta.fine), 'iinf');
    if (!iinf) return null;
    var versione = dv.getUint8(iinf.corpo);
    var inizio = iinf.corpo + 4 + (versione === 0 ? 2 : 4);
    var voci = scatole(dv, inizio, iinf.fine);
    for (var i = 0; i < voci.length; i++) {
      if (voci[i].tipo !== 'infe') continue;
      var c = voci[i].corpo;
      var v = dv.getUint8(c);
      if (v < 2) continue;
      var id, tipo;
      if (v === 2) { id = dv.getUint16(c + 4); tipo = quattro(dv, c + 8); }
      else { id = dv.getUint32(c + 4); tipo = quattro(dv, c + 10); }
      if (tipo === 'Exif') return id;
    }
    return null;
  }

  // Posizione (punti di inizio e lunghezza nel file) dei dati di un elemento, dalla tabella iloc.
  function estensioniElemento(dv, meta, idCercato) {
    var iloc = trovaScatola(scatole(dv, meta.corpo + 4, meta.fine), 'iloc');
    if (!iloc) return null;
    var c = iloc.corpo;
    var versione = dv.getUint8(c);
    var dimOffset = dv.getUint8(c + 4) >> 4, dimLunghezza = dv.getUint8(c + 4) & 15;
    var dimBase = dv.getUint8(c + 5) >> 4, dimIndice = versione >= 1 ? dv.getUint8(c + 5) & 15 : 0;
    var p = c + 6;
    var quanti;
    if (versione < 2) { quanti = dv.getUint16(p); p += 2; } else { quanti = dv.getUint32(p); p += 4; }
    for (var i = 0; i < quanti; i++) {
      var id;
      if (versione < 2) { id = dv.getUint16(p); p += 2; } else { id = dv.getUint32(p); p += 4; }
      var metodo = 0;
      if (versione >= 1) { metodo = dv.getUint16(p) & 15; p += 2; }
      p += 2; // data_reference_index
      var base = leggiN(dv, p, dimBase); p += dimBase;
      var numEstensioni = dv.getUint16(p); p += 2;
      var estensioni = [];
      for (var k = 0; k < numEstensioni; k++) {
        if (dimIndice) p += dimIndice;
        var off = leggiN(dv, p, dimOffset); p += dimOffset;
        var len = leggiN(dv, p, dimLunghezza); p += dimLunghezza;
        estensioni.push({ da: base + off, lunghezza: len });
      }
      if (id === idCercato) return metodo === 0 ? estensioni : null;
    }
    return null;
  }

  function trovaIntestazioneTiff(dv, da) {
    for (var p = da; p + 4 <= dv.byteLength && p < da + 32; p++) {
      var a = dv.getUint16(p);
      if ((a === 0x4949 && dv.getUint16(p + 2, true) === 42) || (a === 0x4D4D && dv.getUint16(p + 2, false) === 42)) return p;
    }
    return -1;
  }

  async function leggiHeic(file, testa) {
    var r = nuovoRisultato('heic');
    var buf = testa;
    var dv = new DataView(buf);
    var meta = trovaScatola(scatole(dv, 0, dv.byteLength), 'meta');
    if (meta && meta.troncata) {
      if (meta.dimensione > MAX_META) throw new Error('struttura HEIC troppo grande');
      buf = await file.slice(0, meta.inizio + meta.dimensione).arrayBuffer();
      dv = new DataView(buf);
      meta = trovaScatola(scatole(dv, 0, dv.byteLength), 'meta');
    }
    if (!meta) throw new Error('struttura HEIC non riconosciuta');

    var id = idElementoExif(dv, meta);
    if (id === null) return r; // HEIC senza EXIF
    var estensioni = estensioniElemento(dv, meta, id);
    if (!estensioni || estensioni.length === 0) throw new Error('dati EXIF dell\'HEIC non raggiungibili');
    var totale = 0;
    estensioni.forEach(function (e) { totale += e.lunghezza; });
    if (totale < 8 || totale > MAX_EXIF) throw new Error('dati EXIF dell\'HEIC di dimensione anomala');

    var pezzi = await Promise.all(estensioni.map(function (e) {
      return file.slice(e.da, e.da + e.lunghezza).arrayBuffer();
    }));
    var dati = new Uint8Array(totale);
    var scritti = 0;
    pezzi.forEach(function (pezzo) { dati.set(new Uint8Array(pezzo), scritti); scritti += pezzo.byteLength; });
    if (scritti !== totale) throw new Error('lettura EXIF dell\'HEIC incompleta');

    var dvExif = new DataView(dati.buffer);
    var tiff = 4 + dvExif.getUint32(0); // il primo numero indica dove inizia l'intestazione TIFF
    var a = dvExif.getUint16(Math.min(tiff, totale - 2));
    if (tiff + 8 > totale || (a !== 0x4949 && a !== 0x4D4D)) tiff = trovaIntestazioneTiff(dvExif, 0);
    if (tiff < 0) throw new Error('EXIF dell\'HEIC non valido');
    leggiTiff(dvExif, tiff, r);
    return r;
  }

  // ---- Punto d'ingresso ----
  async function leggi(file) {
    var formato = 'altro';
    try {
      var testa = await file.slice(0, LUNGHEZZA_TESTA).arrayBuffer();
      var dv = new DataView(testa);
      if (dv.byteLength >= 4 && dv.getUint16(0) === 0xFFD8) {
        formato = 'jpeg';
        return leggiJpeg(dv);
      }
      if (dv.byteLength >= 12 && quattro(dv, 4) === 'ftyp' && MARCHE_HEIC.indexOf(quattro(dv, 8)) !== -1) {
        formato = 'heic';
        return await leggiHeic(file, testa);
      }
      return nuovoRisultato(formato);
    } catch (errore) {
      var r = nuovoRisultato(formato);
      r.errore = errore && errore.message ? errore.message : String(errore);
      return r;
    }
  }

  return { leggi: leggi };
});
