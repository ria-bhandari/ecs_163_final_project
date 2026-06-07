# Is Climate Change Occurring Uniformly Across the World?

ECS 163 final project. This is an interactive dashboard for exploring how temperature and sea level have changed over time, and how those changes differ by region. The short answer we are trying to show: they do not change the same way everywhere.

## What you will see

The page is split into two sections. Scroll down when you are ready for the map.

**Top row (time series views)**

- **Parallel coordinates** – Eight U.S. states plotted across year, average temperature, and uncertainty. Drag on any axis to filter the lines.
- **Sea level streamgraph** – Regional sea level anomalies stacked by ocean basin from 1992 to 2008.
- **Line chart** – California county temperature and sea level trends from 1998 - 2013.

**Bottom section (geographic map)**

- **Global temperature map** – Countries are colored by a 5-year average temperature change compared to 30 years earlier. Red means warmed, blue means cooled.
- **Year slider** – Scrub through 1784 to 2013.
- **Zoom** – Click a country to zoom in. City dots appear once you zoom far enough.
- **California panel** – Click the mini map in the corner to open a full California view with county-level temperature data, or switch to coastal sea level mode with tide gauge stations.

We spent extra time on California because NOAA provides county temperature anomalies and a solid network of tide gauges along the coast.

## How to run it

The dashboard loads CSV files from the `alldatasets/` folder, so you need a local server. Opening `index.html` directly in the browser will not work.

From the project root:

```bash
python3 -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

No npm install required. D3 is loaded from a CDN in `index.html`.

## File overview

| File | What it does |
|------|--------------|
| `index.html` | Page structure and chart containers |
| `main.js` | Global map, zoom, year slider, California overlay |
| `temp_script.js` | Parallel coordinates plot |
| `sealevel_script.js` | Sea level streamgraph |
| `style.css` | Layout, typography, map panel styling |
| `parallel_stream.css` | Shared styles for the top chart row |
| `fetch_county_temps.js` | One-time Node script to download CA county temps from NOAA |
| `extract_noaa_data.js` | One-time Node script to compile CA tide gauge CSVs |
| `alldatasets/` | All CSV data the visualizations read from |

## Data sources

- **Berkeley Earth (Kaggle)** – Global and state land temperature CSVs in `alldatasets/`
- **NOAA sea level** – Regional anomaly files (`slr_sla_*.csv`) and California tide gauge meantrend files (`941*_meantrend.csv`)
- **NOAA Climate at a Glance** – County temperature anomalies, fetched via `fetch_county_temps.js` and saved to `ca_county_temps.csv`
- **GeoJSON** – Country boundaries and California county shapes, loaded from GitHub at runtime

## How the map colors work

For the selected year, we take the average temperature over the past 5 years and subtract the average from 30 years before that window. The result is the delta you see on the color scale. City dots use the same calculation once you zoom in.

In California detail mode, counties show NOAA temperature anomalies directly. Sea level mode fills counties with a statewide coastal average and places dots at individual tide gauge locations.


