// AI Use Note: Used Claude to create code skeleton before modifying


/* ============================================================
   linechart.js — California Climate Dual-Axis Line Chart
   D3 v7 | Two-panel layout:
     Top:    Full California temperature anomaly history (1768–2013)
     Bottom: Overlapping comparison window (1998–2013)
   ============================================================ */

(function drawCaliforniaLineChart() {

const TEMP_COLOR  = "#b2182b";
const SEA_COLOR   = "#2166ac";
const OCEAN_COLOR = "#e8f4fc";

const M_TOP    = { top: 48, right: 110, bottom: 28, left: 70 };
const M_BOTTOM = { top: 20, right: 100, bottom: 72, left: 70 };
const PANEL_GAP = 28;

// ── State ─────────────────────────────────────────────────────
let svgEl, topG, botG;
let xScaleTop, xScaleBot;
let yTempTop, yTempBot, ySeaBot;
let tempLineTop, tempLineBot, seaLineBot;
let hoverRule, dotTemp, dotSea;
let tempSeries  = [];
let seaSeries   = [];
let allBotYears = [];
let rawTempData = [];
let rawSeaData = [];
let rawCACountySea = [];
let rawCACountyTemps = [];
let caCountyTempData = {};
let globalTempSeries = [];
const tempMap = new Map();
const seaMap  = new Map();
const linecharttooltip = d3.select("#tooltip");
let chartReady = false;

// ── Aggregation ───────────────────────────────────────────────

// aggregate based on selected region
function aggregateRegionTemps(rows, region) {

    const acc = {};

    // special handler for countries in the arctic circle
    const ARCTIC_COUNTRIES = ["Norway", "Iceland", "Greenland", "Russia", "Canada"];

    rows.forEach (d => {
        if(!d.dt || !d.AverageTemperature) return;
        const year = parseInt(d.dt.split("-")[0], 10);
        const val  = parseFloat(d.AverageTemperature);
        if (isNaN(year) || isNaN(val)) return;

        // Filter by region
        if (region === "california" && d.Country !== "United States") return;
        if (region === "arctic" && !ARCTIC_COUNTRIES.includes(d.Country)) return;
        // "global" — no filter, keep everything

        if (!acc[year]) acc[year] = { sum: 0, count: 0 };
        acc[year].sum   += val;
        acc[year].count += 1;
    });

    const out = {};
    Object.keys(acc).forEach(y => out[y] = acc[y].sum / acc[y].count);
    const mean = d3.mean(Object.values(out));
    Object.keys(out).forEach(y => out[y] -= mean);
    return out;
}

function aggregateCACountyTemps(rows) {
    const acc = {};
    rows.forEach(d => {
        if (!d.Anomaly || !d.Year || !d.County) return;
        const year = parseInt(d.Year);
        const anomaly = parseFloat(d.Anomaly);
        const county = d.County;
        if (isNaN(year) || isNaN(anomaly)) return;

        if (!acc[county]) acc[county] = {};
        acc[county][year] = anomaly;
    });

    return acc;
}

function aggregateCaliforniaSeaLevel(rows) {
    const acc = {};
    rows.forEach(d => {
        if (!d.Date || d.MeanSeaLevelAnomaly === undefined) return;
        const year    = parseInt(d.Date.split("-")[0], 10);
        const anomaly = parseFloat(d.MeanSeaLevelAnomaly) * 1000;
        if (!isNaN(year) && !isNaN(anomaly)) {
            if (!acc[year]) acc[year] = { sum: 0, count: 0 };
            acc[year].sum   += anomaly;
            acc[year].count += 1;
        }
    });
    const out = {};
    Object.keys(acc).forEach(y => out[y] = acc[y].sum / acc[y].count);
    return out;
}

// Define the 3 counties to show
const COUNTY_COLORS = {
    "Los Angeles":   "#e41a1c",
    "San Francisco": "#377eb8",
    "San Diego":     "#984ea3",
};

const STATION_COLORS = {
    "Los Angeles":   "#e41a1c",
    "San Francisco": "#377eb8",
    "San Diego":     "#984ea3"
};

function drawStationLines(activeStations) {
    if (!botG) return;
    // Remove old station lines before redrawing
    botG.selectAll(".station-line").remove();

    activeStations.forEach(stationName => {
        // Build series from rawCACountySea rows for this station
        const series = rawCACountySea
            .filter(d => d.Station === stationName && d.Date && d.MeanSeaLevelAnomaly !== undefined)
            .map(d => ({
                year: parseInt(d.Date.split("-")[0], 10),
                value: parseFloat(d.MeanSeaLevelAnomaly) * 1000
            }))
            .filter(d => !isNaN(d.year) && !isNaN(d.value))
            .sort((a, b) => a.year - b.year);

        if (!series.length) return;

        const stationLine = d3.line()
            .defined(d => !isNaN(d.value))
            .x(d => xScaleBot(d.year))
            .y(d => ySeaBot(d.value))  // uses sea level scale, not temp
            .curve(d3.curveMonotoneX);

        botG.append("path")
            .datum(series)
            .attr("class", "station-line")
            .attr("fill", "none")
            .attr("stroke", STATION_COLORS[stationName])
            .attr("stroke-width", "1.5px")
            .attr("stroke-dasharray", "6 3")  // dashed to distinguish from temp lines
            .attr("opacity", 0.75)
            .attr("clip-path", "url(#clip-bot)")
            .attr("d", stationLine);
    });
}

function drawCountyLines(innerWT, innerHT, activeCounties) {
    if (!botG) return;
    // Remove old lines before redrawing
    botG.selectAll(".county-line").remove();

    // Only loop through checked counties, not all of COUNTY_COLORS
    activeCounties.forEach(countyName => {
        const countyYears = caCountyTempData[countyName];
        if (!countyYears) return;

        const series = Object.keys(countyYears).map(y => ({
            year: parseInt(y),
            value: countyYears[y]
        })).filter(d => !isNaN(d.year) && !isNaN(d.value))
           .sort((a, b) => a.year - b.year);

        const countyLine = d3.line()
            .defined(d => !isNaN(d.value))
            .x(d => xScaleBot(d.year))
            .y(d => yTempBot(d.value))
            .curve(d3.curveMonotoneX);

        botG.append("path")
            .datum(series)
            .attr("class", "county-line")
            .attr("fill", "none")
            .attr("stroke", COUNTY_COLORS[countyName])
            .attr("stroke-width", "1.5px")
            .attr("opacity", 0.75)
            .attr("clip-path", "url(#clip-bot)")
            .attr("d", countyLine);
    });
}

function getCheckedCounties() {
    // Get all checked checkboxes and return their values as an array
    return Array.from(document.querySelectorAll(".county-cb:checked"))
                .map(cb => cb.value);
}


// ── Chart init ────────────────────────────────────────────────
function initChart() {
    const container = document.getElementById("chart-container");
    const W  = container.clientWidth  || 900;
    const H  = container.clientHeight || 520;

    const topH = 0;
    const botH    = H - M_BOTTOM.top - M_BOTTOM.bottom;
    const innerWT = W - M_TOP.left    - M_TOP.right;
    const innerHT = topH - M_TOP.top  - M_TOP.bottom;
    const innerWB = W - M_BOTTOM.left - M_BOTTOM.right;
    const innerHB = botH - M_BOTTOM.top - M_BOTTOM.bottom;

    svgEl = d3.select("#linechart-svg")
        .attr("width",   W)
        .attr("height",  H)
        .attr("viewBox", `0 0 ${W} ${H}`);

    svgEl.append("rect").attr("width", W).attr("height", H).attr("fill", OCEAN_COLOR);

    // ── Clip paths ──
    const defs = svgEl.append("defs");
    defs.append("clipPath").attr("id", "clip-bot")
        .append("rect").attr("width", innerWB).attr("height", innerHB);

    // ════════════════════════════════════════════════
    // BOTTOM PANEL — comparison window 1998–2013
    // ════════════════════════════════════════════════
    const botOffsetY = topH + PANEL_GAP;
    botG = svgEl.append("g")
        .attr("transform", `translate(${M_BOTTOM.left},${botOffsetY + M_BOTTOM.top})`);

    xScaleBot = d3.scaleLinear().range([0, innerWB]);
    yTempBot  = d3.scaleLinear().range([innerHB, 0]);
    ySeaBot   = d3.scaleLinear().range([innerHB, 0]);

    botG.append("g").attr("class", "grid-group-bot");
    botG.append("rect").attr("class", "data-band").attr("id", "sea-band");
    botG.append("g").attr("class", "x-axis-bot").attr("transform", `translate(0,${innerHB})`);
    botG.append("g").attr("class", "y-axis-bot-left");
    botG.append("g").attr("class", "y-axis-bot-right")
        .attr("transform", `translate(${innerWB},0)`);

    botG.append("path").attr("class", "line-temp").attr("id", "path-temp-bot")
        .attr("clip-path", "url(#clip-bot)")
        .style("stroke-width", "2.5px");

    // Bottom panel subtitle
    svgEl.append("text").attr("class", "panel-label")
        .attr("x", W / 2)
        .attr("y", botOffsetY + 14)
        .attr("text-anchor", "middle")
        .style("font-family", "Arial, sans-serif")
        .style("font-size", "0.78rem")
        .style("font-weight", "700")
        .style("fill", "#333")
        .text("County Temp (solid) & Sea Level (dashed) from 1998–2013");

    // Left Y axis title (bottom panel)
    svgEl.append("text").attr("class", "axis-title")
        .attr("transform", "rotate(-90)")
        .attr("x", -(botOffsetY + M_BOTTOM.top + innerHB / 2))
        .attr("y", 16)
        .attr("text-anchor", "middle")
        .style("font-family", "Arial, sans-serif").style("font-size", "0.78rem")
        .style("font-weight", "700").style("fill", TEMP_COLOR)
        .text("Temp Anomaly (°C)");

    svgEl.append("text").attr("class", "axis-title")
        .attr("transform", "rotate(90)")
        .attr("x", botOffsetY + M_BOTTOM.top + innerHB / 2)
        .attr("y", -(W - 12))
        .attr("text-anchor", "middle")
        .style("font-family", "Arial, sans-serif").style("font-size", "0.75rem")
        .style("font-weight", "700").style("fill", SEA_COLOR)
        .text("Sea Level Anomaly (mm)");

    // X axis title
    svgEl.append("text").attr("class", "axis-title")
        .attr("x", M_BOTTOM.left + innerWB / 2)
        .attr("y", H - 10)
        .attr("text-anchor", "middle")
        .style("font-family", "Arial, sans-serif").style("font-size", "0.82rem")
        .style("font-weight", "700").style("fill", "#333")
        .text("Year");

    // line generators
    tempLineTop = d3.line()
        .defined(d => !isNaN(d.value))
        .x(d => xScaleTop(d.year))
        .y(d => yTempTop(d.value))
        .curve(d3.curveMonotoneX);

    tempLineBot = d3.line()
        .defined(d => !isNaN(d.value))
        .x(d => xScaleBot(d.year))
        .y(d => yTempBot(d.value))
        .curve(d3.curveMonotoneX);

    seaLineBot = d3.line()
        .defined(d => !isNaN(d.value))
        .x(d => xScaleBot(d.year))
        .y(d => ySeaBot(d.value))
        .curve(d3.curveMonotoneX);

    return { innerWT, innerHT, innerWB, innerHB };
}

// ── Render ────────────────────────────────────────────────────
function renderChart(innerWT, innerHT, innerWB, innerHB) {
    const seaYears  = seaSeries.map(d => d.year);
    const tempYears = tempSeries.map(d => d.year);

    // ── BOTTOM PANEL ──
    const BOT_XMIN = 1997;
    const BOT_XMAX = 2014;
    xScaleBot.domain([BOT_XMIN, BOT_XMAX]);

const countyValues = Object.keys(COUNTY_COLORS).flatMap(name =>
    Object.values(caCountyTempData[name] || {})
);
const cExt = d3.extent(countyValues);
const cAbs = Math.max(Math.abs(cExt[0] || 1), Math.abs(cExt[1] || 1));
yTempBot.domain([-cAbs * 1.25, cAbs * 1.25]).nice();

    const sExt = d3.extent(seaSeries, d => d.value);
    const sPad = (sExt[1] - sExt[0]) * 0.3 || 20;
    ySeaBot.domain([sExt[0] - sPad, sExt[1] + sPad]).nice();

    d3.select("#sea-band")
        .attr("x", xScaleBot(d3.min(seaYears)))
        .attr("y", 0)
        .attr("width",  xScaleBot(d3.max(seaYears)) - xScaleBot(d3.min(seaYears)))
        .attr("height", innerHB);

    const gridBot = d3.select(".grid-group-bot");
    gridBot.selectAll(".grid-line").remove();
    yTempBot.ticks(5).forEach(t => {
        gridBot.append("line").attr("class", "grid-line")
            .attr("x1", 0).attr("x2", innerWB)
            .attr("y1", yTempBot(t)).attr("y2", yTempBot(t));
    });
    xScaleBot.ticks(8).forEach(t => {
        gridBot.append("line").attr("class", "grid-line")
            .attr("x1", xScaleBot(t)).attr("x2", xScaleBot(t))
            .attr("y1", 0).attr("y2", innerHB);
    });

    botG.select(".x-axis-bot")
        .call(
            d3.axisBottom(xScaleBot)
                .tickValues(d3.range(1998, 2014, 2))
                .tickFormat(d3.format("d"))
        )
        .selectAll("text")
            .style("font-size", "0.72rem")
            .attr("transform", "rotate(-35)")
            .attr("text-anchor", "end")
            .attr("dx", "-0.35em")
            .attr("dy", "0.45em");

    botG.select(".y-axis-bot-left")
        .call(d3.axisLeft(yTempBot).ticks(5)
            .tickFormat(d => (d > 0 ? "+" : "") + d.toFixed(1) + "°C"))
        .selectAll("text").style("fill", TEMP_COLOR).style("font-size", "0.78rem");
    botG.select(".y-axis-bot-left").selectAll(".tick line, .domain").style("stroke", TEMP_COLOR);

    botG.select(".y-axis-bot-right")
        .call(d3.axisRight(ySeaBot).ticks(5)
            .tickFormat(d => (d > 0 ? "+" : "") + d.toFixed(0) + " mm"))
        .selectAll("text").style("fill", SEA_COLOR).style("font-size", "0.78rem");
    botG.select(".y-axis-bot-right").selectAll(".tick line, .domain").style("stroke", SEA_COLOR);

    const tempBot = tempSeries.filter(d => d.year >= BOT_XMIN && d.year <= BOT_XMAX);

    botG.select("#path-temp-bot")
        .datum(tempBot)
        .attr("d", tempLineBot)
        .style("stroke", TEMP_COLOR);

    allBotYears = Array.from(new Set([
        ...tempBot.map(d => d.year),
        ...seaYears
    ])).sort((a, b) => a - b);

    drawCountyLines(innerWT, innerHT, getCheckedCounties());
    drawStationLines(getCheckedCounties());
}

// ── Hover ─────────────────────────────────────────────────────
function onMouseMove(event) {
    const [mx] = d3.pointer(event);
    const hovered = Math.round(xScaleBot.invert(mx));
    const nearest = allBotYears.reduce((p, c) =>
        Math.abs(c - hovered) < Math.abs(p - hovered) ? c : p, allBotYears[0]);

    const tVal = tempMap.get(nearest);
    const sVal = seaMap.get(nearest);
    const x    = xScaleBot(nearest);

    hoverRule.attr("x1", x).attr("x2", x).style("opacity", 1);

    if (tVal !== undefined && !isNaN(tVal)) {
        dotTemp.attr("cx", x).attr("cy", yTempBot(tVal)).style("opacity", 1);
    } else { dotTemp.style("opacity", 0); }

    if (sVal !== undefined && !isNaN(sVal)) {
        dotSea.attr("cx", x).attr("cy", ySeaBot(sVal)).style("opacity", 1);
    } else { dotSea.style("opacity", 0); }

    const tempStr = (tVal !== undefined && !isNaN(tVal))
        ? `<span class="tt-temp">${tVal > 0 ? "+" : ""}${tVal.toFixed(3)}°C</span>`
        : `<span class="tt-na">No data</span>`;
    const seaStr = (sVal !== undefined && !isNaN(sVal))
        ? `<span class="tt-sea">${sVal > 0 ? "+" : ""}${sVal.toFixed(1)} mm</span>`
        : `<span class="tt-na">No data</span>`;

    linecharttooltip.style("opacity", 1).html(`
        <strong>Year: ${nearest}</strong>
        <table style="border-spacing:0 3px; margin-top:2px;">
            <tr>
                <td style="padding-right:8px; color:#555; font-size:0.82rem;">Temp Anomaly</td>
                <td>${tempStr}</td>
            </tr>
            <tr>
                <td style="padding-right:8px; color:#555; font-size:0.82rem;">Sea Level Δ</td>
                <td>${seaStr}</td>
            </tr>
        </table>
    `);

    const px = event.clientX, py = event.clientY;
    const winW = window.innerWidth, winH = window.innerHeight;
    linecharttooltip
        .style("left", (px + 16 + 210 > winW ? px - 226 : px + 16) + "px")
        .style("top",  (py + 96 > winH        ? py - 88  : py + 12) + "px");
}

function onMouseLeave() {
    hoverRule.style("opacity", 0);
    dotTemp.style("opacity", 0);
    dotSea.style("opacity", 0);
    linecharttooltip.style("opacity", 0);
}

// ── Data load ─────────────────────────────────────────────────
(async function loadData() {
    try {
        [rawTempData, rawSeaData, rawCACountyTemps, rawCACountySea] = await Promise.all([
            d3.csv("alldatasets/GlobalLandTemperaturesByCountry.csv"),
            d3.csv("alldatasets/ca_sea_level.csv"),
            d3.csv("alldatasets/ca_county_temps.csv"),
            d3.csv("alldatasets/ca_sea_level_stations.csv")
        ]);

        const caTempByYear = aggregateRegionTemps(rawTempData, "california"); // filters country to US
        tempSeries = Object.keys(caTempByYear) // store filtered result in tempSeries
            .map(y => ({ year: parseInt(y, 10), value: caTempByYear[y] }))
            .filter(d => !isNaN(d.year) && !isNaN(d.value))
            .sort((a, b) => a.year - b.year);

        const globalTempByYear = aggregateRegionTemps(rawTempData, "global");
        globalTempSeries = Object.keys(globalTempByYear)
            .map(y => ({ year: parseInt(y, 10), value: globalTempByYear[y] }))
            .filter(d => !isNaN(d.year) && !isNaN(d.value))
            .sort((a, b) => a.year - b.year);

        const caSeaByYear = aggregateCaliforniaSeaLevel(rawSeaData);
        seaSeries = Object.keys(caSeaByYear)
            .map(y => ({ year: parseInt(y, 10), value: caSeaByYear[y] }))
            .filter(d => !isNaN(d.year) && !isNaN(d.value))
            .sort((a, b) => a.year - b.year);

        caCountyTempData = aggregateCACountyTemps(rawCACountyTemps);

        tempSeries.forEach(d => tempMap.set(d.year, d.value));
        seaSeries.forEach(d  => seaMap.set(d.year,  d.value));

        // Wait for layout so #chart-container has real width/height in the grid
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const { innerWT, innerHT, innerWB, innerHB } = initChart();
        renderChart(innerWT, innerHT, innerWB, innerHB);
        chartReady = true;

    } catch (err) {
        console.error("linechart.js error →", err);
        document.getElementById("chart-container").innerHTML =
            `<p style="padding:24px; color:#b00020; font-family:Arial,sans-serif;">
                ⚠ Could not load data files.<br>
                Ensure <code>alldatasets/GlobalLandTemperaturesByCountry.csv</code> and
                <code>alldatasets/ca_sea_level.csv</code> are available.<br>
                <small>${err.message}</small>
             </p>`;
    }
})();

// REDRAW HANDLER - redraw when the region changes

function redrawRegion(region) {
    const newTempByYear = aggregateRegionTemps(rawTempData, region);
    tempSeries = Object.keys(newTempByYear)
        .map(y => ({year:parseInt(y,10), value: newTempByYear[y]}))
        .filter(d => !isNaN(d.year) && !isNaN(d.value))
        .sort((a,b) => a.year - b.year);

    // rebuild lookup map
    tempMap.clear();
    tempSeries.forEach(d => tempMap.set(d.year, d.value));

    // redraw using resize handler pattern
    // clear SVG and redraw with new data
    d3.select("#linechart-svg").selectAll("*").remove();
    const dims = initChart();
    renderChart(dims.innerWT, dims.innerHT, dims.innerWB, dims.innerHB);
}

// listener

document.querySelectorAll(".county-cb").forEach(cb => {
    cb.addEventListener("change", function() {
        drawCountyLines(null, null, getCheckedCounties());
        drawStationLines(getCheckedCounties());
    });
});

// ── Resize ────────────────────────────────────────────────────
let resizeTimer;
window.addEventListener("resize", () => {
    if (!chartReady) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        d3.select("#linechart-svg").selectAll("*").remove();
        const dims = initChart();
        renderChart(dims.innerWT, dims.innerHT, dims.innerWB, dims.innerHB);
    }, 200);
});

})();
