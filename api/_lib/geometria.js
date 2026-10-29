// Operazioni geometriche semplici su coordinate [lon, lat] (GeoJSON), senza librerie esterne.

// Tutte le linee (o anelli) di una geometria, come elenco di liste di punti [lon, lat].
function lineeDi(geometria) {
  if (!geometria || !geometria.coordinates) return [];
  const taglio = (c) => c.map((p) => [p[0], p[1]]);
  switch (geometria.type) {
    case 'LineString': return [taglio(geometria.coordinates)];
    case 'MultiLineString': return geometria.coordinates.map(taglio);
    case 'Polygon': return geometria.coordinates.map(taglio);
    case 'MultiPolygon': return geometria.coordinates.flatMap((poligono) => poligono.map(taglio));
    default: return [];
  }
}

// Riquadro [ovest, sud, est, nord] che contiene tutti i punti, oppure null se non ce ne sono.
function riquadro(linee) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  linee.forEach((linea) => linea.forEach(([x, y]) => {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }));
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

// Douglas-Peucker (senza ricorsione). "tolleranza" in gradi di latitudine (0,00005 ≈ 5,5 metri):
// la longitudine si scala con il coseno della latitudine media, così le distanze sono omogenee.
function semplifica(linea, tolleranza) {
  if (linea.length <= 2 || !(tolleranza > 0)) return linea.slice();
  const fattore = Math.cos((linea[0][1] * Math.PI) / 180);
  const x = (p) => p[0] * fattore;
  const y = (p) => p[1];
  const tieni = new Uint8Array(linea.length);
  tieni[0] = 1;
  tieni[linea.length - 1] = 1;
  const pila = [[0, linea.length - 1]];
  while (pila.length) {
    const [a, b] = pila.pop();
    let massima = 0;
    let indice = -1;
    const ax = x(linea[a]); const ay = y(linea[a]);
    const dx = x(linea[b]) - ax; const dy = y(linea[b]) - ay;
    const lunghezza2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const px = x(linea[i]) - ax; const py = y(linea[i]) - ay;
      let distanza;
      if (lunghezza2 === 0) {
        distanza = Math.hypot(px, py);
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lunghezza2));
        distanza = Math.hypot(px - t * dx, py - t * dy);
      }
      if (distanza > massima) { massima = distanza; indice = i; }
    }
    if (indice !== -1 && massima > tolleranza) {
      tieni[indice] = 1;
      pila.push([a, indice], [indice, b]);
    }
  }
  return linea.filter((_, i) => tieni[i]);
}

function arrotonda(linea, decimali) {
  const f = 10 ** decimali;
  return linea.map(([lon, lat]) => [Math.round(lon * f) / f, Math.round(lat * f) / f]);
}

// Il punto è dentro un poligono? "poligono" = [anelloEsterno, ...buchi] (ray casting, bordi a parte).
function puntoInPoligono(punto, poligono) {
  const dentroAnello = (anello) => {
    let dentro = false;
    for (let i = 0, j = anello.length - 1; i < anello.length; j = i++) {
      const [xi, yi] = anello[i]; const [xj, yj] = anello[j];
      if ((yi > punto[1]) !== (yj > punto[1]) && punto[0] < ((xj - xi) * (punto[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  };
  if (!dentroAnello(poligono[0])) return false;
  for (let k = 1; k < poligono.length; k++) if (dentroAnello(poligono[k])) return false;
  return true;
}

// "poligoni" = coordinate di un MultiPolygon: [poligono, poligono, ...].
function puntoInMultiPoligono(punto, poligoni) {
  return poligoni.some((p) => puntoInPoligono(punto, p));
}

// Al massimo "massimo" punti presi a intervalli regolari da tutte le linee (sempre il primo e l'ultimo di ogni linea).
function campiona(linee, massimo) {
  const tutti = linee.flat();
  if (tutti.length <= massimo) return tutti;
  const passo = tutti.length / massimo;
  const scelti = [];
  for (let i = 0; i < massimo; i++) scelti.push(tutti[Math.floor(i * passo)]);
  linee.forEach((l) => { if (l.length) { scelti.push(l[0], l[l.length - 1]); } });
  return scelti;
}

function dentroRiquadro(punto, r) {
  return punto[0] >= r[0] && punto[0] <= r[2] && punto[1] >= r[1] && punto[1] <= r[3];
}

// Settori in cui cade il tracciato: basta un punto campionato dentro il confine.
// settori: [{ id, riquadro, poligoni }]
function settoriDelTracciato(linee, settori) {
  const punti = campiona(linee, 60);
  return settori
    .filter((s) => s.riquadro && s.poligoni && punti.some((p) => dentroRiquadro(p, s.riquadro) && puntoInMultiPoligono(p, s.poligoni)))
    .map((s) => s.id);
}

module.exports = { lineeDi, riquadro, semplifica, arrotonda, puntoInPoligono, puntoInMultiPoligono, campiona, settoriDelTracciato };
