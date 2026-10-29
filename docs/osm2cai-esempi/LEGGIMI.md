# Campioni delle risposte di OSM2CAI

Raccolti il 29/10/2026 dal responsabile con il browser (i server del CAI non sono raggiungibili dall'ambiente di sviluppo). Servono per provare la sincronizzazione.

| File | Richiesta | Contenuto |
|---|---|---|
| `osm2cai-settori-lista.json` | `/api/v3/sectors/list?bbox=10.9,44.0,11.8,44.7` | 27 settori: `id`, `updated_at`, `name.it` (il codice, es. `HBOE8`) |
| `osm2cai-percorsi-bbox.json` | `/api/v2/hiking-routes/bb/11.2,44.4,11.4,44.5/4` | 23 percorsi validati (SDA 4): `id` → data di aggiornamento |
| `osm2cai-percorso-532-ridotto.json` | `/api/v2/hiking-route/532` | Feature con `ref`, `name.it`, `from`, `to`, `sda`, `cai_scale`, `updated_at`, `taxonomy_where`...; **ridotto a 2 tratti** del disegno (`MultiLineString`) |
| `osm2cai-settore-3-ridotto.json` | `/api/v3/sectors/3` | Feature con `MultiPolygon` e `properties` (`id`, `name.it`, `code`, `full_code`, `human_name`, `manager`...); **poligono ridotto** (l'originale ha circa 1000 vertici) |

Cose da sapere sui dati:
- I settori hanno solo un codice (`human_name` e `manager` sono `null`): per il menu dei volontari servono nomi leggibili, che gli admin possono dare dal sito.
- Il dettaglio di un percorso **non indica il settore**: si ricava confrontando il tracciato con i confini dei settori.
- Le coordinate sono `[lon, lat]` (i percorsi hanno anche una quota `0`).
