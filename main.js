// Global temperature map, California detail overlay, and year slider.
// Coloring is based on a 5-year temp delta vs. 30 years earlier.

const MAP_PADDING = 28;
const CITY_ZOOM_THRESHOLD = 2.2;
const OCEAN_COLOR = "#e8f4fc";
const DELTA_DOMAIN = [-2.5, 0, 2.5];
const DELTA_YEARS = 30;
const DELTA_WINDOW = 5;
const SLIDER_MIN = 1780 + DELTA_WINDOW - 1;
const SLIDER_MAX = 2013;

const container = d3.select("#map-container");
const mapRect = container.node()?.getBoundingClientRect() ?? { width: 0, height: 0 };
const width = Math.max(mapRect.width, 800);
const height = Math.max(mapRect.height, 480);

const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

svg.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", OCEAN_COLOR)
    .on("click", resetZoom);

const mapGroup = svg.append("g");
const countryLayer = mapGroup.append("g").attr("class", "country-layer");
const cityLayer = mapGroup.append("g").attr("class", "city-layer");
const tooltip = d3.select("#tooltip");

const projection = d3.geoMercator();
const pathGenerator = d3.geoPath().projection(projection);

const colorScale = d3.scaleDiverging()
    .domain(DELTA_DOMAIN)
    .interpolator(t => d3.interpolateRdBu(1 - t));

// California overlay state and a separate blue scale for sea level anomalies
const seaLevelColorScale = d3.scaleSequential()
    .domain([-50, 250]) 
    .interpolator(d3.interpolateBlues);
let caTempDataByYear = {};
let caSeaLevelDataByYear = {};
let caSeaStations = [];
let caCitiesArray = []; // Pre-filtered CA cities so the overlay does not re-scan the full dataset
let isCaExpanded = false;
let caViewMode = 'temp'; 
let countryDataByYear = {};
let cities = [];
let geoData = null;
let activeCountry = d3.select(null);
let currentYear = 2000;
let currentTransform = d3.zoomIdentity;
let caZoomTransform = d3.zoomIdentity;

let caCountiesGeoData = null;
let caCountyTempDataByYear = {}; // { countyName: { year: anomaly } }

const zoomBehavior = d3.zoom()
    .scaleExtent([1, 14])
    .on("zoom", (event) => {
        currentTransform = event.transform;
        mapGroup.attr("transform", event.transform);
        updateCityLayer();
    });

svg.call(zoomBehavior);

renderLegend('temp');

// Load geo boundaries and all temperature / sea level CSVs in one pass
Promise.all([
    d3.json("https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"),

    d3.csv("alldatasets/GlobalLandTemperaturesByCountry.csv"),
    d3.csv("alldatasets/GlobalLandTemperaturesByMajorCity.csv"),
    d3.csv("alldatasets/GlobalLandTemperaturesByCity.csv"),

    d3.json("https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/california-counties.geojson"),

    d3.csv("alldatasets/ca_county_temps.csv"),
    d3.csv("alldatasets/ca_sea_level.csv"),
    d3.csv("alldatasets/ca_sea_level_stations.csv")
])
.then(([
    geo,
    rawCountryData,
    rawMajorCityData,
    rawAllCityData,
    caCounties,
    rawCountyData,
    rawSeaData,
    rawSeaStations
]) => {
    
    geoData = geo;
    caCountiesGeoData = caCounties; 
    
    // County-level NOAA anomalies for the CA detail view
    caCountyTempDataByYear = {};
    rawCountyData.forEach(d => {
        if (!caCountyTempDataByYear[d.County]) caCountyTempDataByYear[d.County] = {};
        caCountyTempDataByYear[d.County][d.Year] = parseFloat(d.Anomaly);
    });

    // Statewide average derived from counties (used to color the US on the global map)
    caTempDataByYear = {};
    const stateAcc = {};
    rawCountyData.forEach(d => {
        const year = d.Year;
        const val = parseFloat(d.Anomaly);
        if (!isNaN(val)) {
            if (!stateAcc[year]) stateAcc[year] = { sum: 0, count: 0 };
            stateAcc[year].sum += val;
            stateAcc[year].count += 1;
        }
    });
    Object.keys(stateAcc).forEach(year => {
        caTempDataByYear[year] = stateAcc[year].sum / stateAcc[year].count;
    });

    caSeaLevelDataByYear = aggregateCaliforniaSeaLevel(rawSeaData);
    caSeaStations = aggregateSeaStations(rawSeaStations);

    caGeoFeature = caCounties; 

    projection.fitExtent(
        [[MAP_PADDING, MAP_PADDING], [width - MAP_PADDING, height - MAP_PADDING]],
        geoData
    );
    pathGenerator.projection(projection);

    countryDataByYear = aggregateCountryTemps(rawCountryData);
    cities = aggregateCityTemps(rawMajorCityData);
    
    const allCities = aggregateCityTemps(rawAllCityData);
    caCitiesArray = allCities.filter(c => {
        return c.lat >= 32.5 && c.lat <= 42.0 && c.lon >= -124.5 && c.lon <= -114.1;
    });

    countryLayer.selectAll("path")
        .data(geoData.features)
        .join("path")
        .attr("class", "country")
        .attr("d", pathGenerator)
        .on("click", clickedCountry)
        .on("mouseover", showCountryTooltip)
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip);

    drawMiniMap();
    drawOverlayMap();
    
    updateMapColors(currentYear);

}).catch(err => {
    console.error("Error setting up map:", err);
});

// --- Data helpers ---

function normalizeCountryName(country) {
    if (country === "United States") return "United States of America";
    if (country === "Congo (Democratic Republic of the)") return "Democratic Republic of the Congo";
    return country;
}

function parseCoord(str) {
    if (!str) return NaN;
    const hem = str.slice(-1).toUpperCase();
    const num = parseFloat(str);
    return (hem === "S" || hem === "W") ? -num : num;
}

// Compare a 5-year window to the same window 30 years ago
function tempDelta(years, year) {
    const deltas = [];
    for (let i = 0; i < DELTA_WINDOW; i++) {
        const y = year - i;
        const curr = years[y];
        const past = years[y - DELTA_YEARS];
        if (curr === undefined || past === undefined) continue;
        deltas.push(curr - past);
    }
    if (deltas.length < DELTA_WINDOW) return undefined;
    return d3.mean(deltas);
}

function aggregateCountryTemps(rows) {
    const acc = {};
    rows.forEach(d => {
        if (!d.dt || !d.AverageTemperature || !d.Country) return;
        const year = parseInt(d.dt.split("-")[0], 10);
        const temp = parseFloat(d.AverageTemperature);
        const country = normalizeCountryName(d.Country);
        if (isNaN(year) || isNaN(temp)) return;

        if (!acc[country]) acc[country] = {};
        if (!acc[country][year]) acc[country][year] = { sum: 0, count: 0 };
        acc[country][year].sum += temp;
        acc[country][year].count += 1;
    });

    const out = {};
    Object.keys(acc).forEach(country => {
        out[country] = {};
        Object.keys(acc[country]).forEach(year => {
            const bucket = acc[country][year];
            out[country][year] = bucket.sum / bucket.count;
        });
    });
    return out;
}

function aggregateCityTemps(rows) {
    const cityMap = new Map();
    rows.forEach(d => {
        if (!d.dt || !d.AverageTemperature || !d.City) return;
        const year = parseInt(d.dt.split("-")[0], 10);
        const temp = parseFloat(d.AverageTemperature);
        const lat = parseCoord(d.Latitude);
        const lon = parseCoord(d.Longitude);
        if (isNaN(year) || isNaN(temp) || isNaN(lat) || isNaN(lon)) return;

        const country = normalizeCountryName(d.Country);
        const key = `${d.City}|${country}|${lat}|${lon}`;
        if (!cityMap.has(key)) {
            cityMap.set(key, { city: d.City, country, lat, lon, years: {} });
        }
        const entry = cityMap.get(key);
        if (!entry.years[year]) entry.years[year] = { sum: 0, count: 0 };
        entry.years[year].sum += temp;
        entry.years[year].count += 1;
    });

    return Array.from(cityMap.values()).map(c => {
        const years = {};
        Object.keys(c.years).forEach(year => {
            const bucket = c.years[year];
            years[year] = bucket.sum / bucket.count;
        });
        return { ...c, years };
    });
}

// Swap the color bar between temperature (red/blue) and sea level (blues)
function renderLegend(mode) {
    const barWidth = 26;
    const barHeight = 220;
    const marginTop = 10;

    const isTemp = (mode === 'temp');
    const activeScale = isTemp ? colorScale : seaLevelColorScale;
    
    const [lo, hi] = isTemp ? [-2.5, 2.5] : [-50, 250];

    const titleText = isTemp ? "5-yr avg Δ vs 30 yrs ago (°C)" : "Sea Level Anomaly vs Baseline (mm)";
    d3.select("#legend-title").text(titleText);
    
    d3.select("#legend-high-label")
        .text(isTemp ? "Warmed" : "Higher")
        .style("color", isTemp ? "#b2182b" : "#08519c");

    d3.select("#legend-low-label")
        .text(isTemp ? "Cooled" : "Lower")
        .style("color", isTemp ? "#2166ac" : "#eff3ff");

    const legendSvg = d3.select("#colorbar-svg");
    legendSvg.selectAll("*").remove();

    legendSvg.attr("width", barWidth + 60)
             .attr("height", barHeight + marginTop + 10);

    const defs = legendSvg.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "dynamic-gradient")
        .attr("x1", "0%")
        .attr("y1", "100%")
        .attr("x2", "0%")
        .attr("y2", "0%");

    const steps = 24;
    for (let i = 0; i <= steps; i++) {
        const val = lo + (i / steps) * (hi - lo);
        gradient.append("stop")
            .attr("offset", `${(i / steps) * 100}%`)
            .attr("stop-color", activeScale(val));
    }

    legendSvg.append("rect")
        .attr("x", 0)
        .attr("y", marginTop)
        .attr("width", barWidth)
        .attr("height", barHeight)
        .attr("rx", 3)
        .style("fill", "url(#dynamic-gradient)");

    const axisScale = d3.scaleLinear()
        .domain([lo, hi])
        .range([barHeight + marginTop, marginTop]);

    const axisFormat = isTemp
        ? d => (d === 0 ? "0" : (d > 0 ? "+" : "") + d.toFixed(1) + "°C")
        : d => (d === 0 ? "0" : (d > 0 ? "+" : "") + d.toFixed(1) + " mm");

    legendSvg.append("g")
        .attr("transform", `translate(${barWidth}, 0)`)
        .call(d3.axisRight(axisScale).ticks(5).tickFormat(axisFormat));
}

function getViewportBounds(transform) {
    const corners = [
        transform.invert([0, 0]),
        transform.invert([width, 0]),
        transform.invert([width, height]),
        transform.invert([0, height])
    ].map(p => projection.invert(p)).filter(Boolean);

    if (!corners.length) return null;

    const lons = corners.map(c => c[0]);
    const lats = corners.map(c => c[1]);
    return {
        lonMin: Math.min(...lons),
        lonMax: Math.max(...lons),
        latMin: Math.min(...lats),
        latMax: Math.max(...lats)
    };
}

function citiesInView() {
    const bounds = getViewportBounds(currentTransform);
    if (!bounds) return [];

    return cities.filter(c =>
        c.lon >= bounds.lonMin && c.lon <= bounds.lonMax &&
        c.lat >= bounds.latMin && c.lat <= bounds.latMax
    );
}

function dotRadius() {
    return Math.max(2, 3 / currentTransform.k);
}

function formatDelta(delta) {
    if (delta === undefined) return "No data";
    const sign = delta > 0 ? "+" : "";
    const endYear = currentYear;
    const startYear = currentYear - DELTA_WINDOW + 1;
    const baselineEnd = endYear - DELTA_YEARS;
    const baselineStart = startYear - DELTA_YEARS;
    return `${sign}${delta.toFixed(2)}°C avg (${startYear}–${endYear} vs ${baselineStart}–${baselineEnd})`;
}

// City dots only show up after zooming in past the threshold
function updateCityLayer() {
    const showCities = currentTransform.k >= CITY_ZOOM_THRESHOLD;
    cityLayer.style("display", showCities ? null : "none");
    if (!showCities) return;

    const visible = citiesInView();
    const r = dotRadius();

    const join = cityLayer.selectAll("circle.city-point")
        .data(visible, d => `${d.city}|${d.country}|${d.lat}|${d.lon}`);

    join.exit().remove();

    join.enter()
        .append("circle")
        .attr("class", "city-point")
        .on("mouseover", showCityTooltip)
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip)
        .merge(join)
        .attr("cx", d => projection([d.lon, d.lat])[0])
        .attr("cy", d => projection([d.lon, d.lat])[1])
        .attr("r", r)
        .attr("fill", d => {
            const delta = tempDelta(d.years, currentYear);
            return delta !== undefined ? colorScale(delta) : "#e0e0e0";
        })
        .attr("stroke", "#2a2a2a")
        .attr("stroke-width", 0.5)
        .attr("opacity", d => tempDelta(d.years, currentYear) !== undefined ? 0.95 : 0.4);
}

function clickedCountry(event, d) {
    if (activeCountry.node() === this) return resetZoom();

    activeCountry.classed("active", false);
    activeCountry = d3.select(this).classed("active", true);
    let [[x0, y0], [x1, y1]] = pathGenerator.bounds(d);
    // USA bounds are tweaked manually because the raw bbox zooms awkwardly
    if(d.properties.name == "United States of America"){
        x0 = projection([200, 32])[0];
        y0 = projection([200, 32])[1];
        x1 = projection([300, 38])[0];
        y1 = projection([300, 38])[1];
    }
    event.stopPropagation();

    svg.transition().duration(750).call(
        zoomBehavior.transform,
        d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(Math.min(10, 0.92 / Math.max((x1 - x0) / width, (y1 - y0) / height)))
            .translate(-(x0 + x1) / 2, -(y0 + y1) / 2)
    );
}

function resetZoom() {
    activeCountry.classed("active", false);
    activeCountry = d3.select(null);
    svg.transition().duration(750).call(zoomBehavior.transform, d3.zoomIdentity);
}

function showCountryTooltip(event, d) {
    const countryName = d.properties.name;
    const history = countryDataByYear[countryName];
    const temp = history?.[currentYear];
    const delta = history ? tempDelta(history, currentYear) : undefined;

    const tempLine = temp !== undefined ? `${temp.toFixed(2)}°C avg` : "No avg temp";
    const deltaLine = formatDelta(delta);

    tooltip.style("opacity", 1)
        .html(`<strong>${countryName}</strong><br/>Year: ${currentYear}<br/>${tempLine}<br/>Δ: ${deltaLine}`);
}

function showCityTooltip(event, d) {
    const temp = d.years[currentYear];
    const delta = tempDelta(d.years, currentYear);
    const tempLine = temp !== undefined ? `${temp.toFixed(2)}°C avg` : "No avg temp";

    tooltip.style("opacity", 1)
        .html(`<strong>${d.city}</strong>, ${d.country}<br/>Year: ${currentYear}<br/>${tempLine}<br/>Δ: ${formatDelta(delta)}`);
}

function moveTooltip(event) {
    tooltip.style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY - 15) + "px");
}

function hideTooltip() {
    tooltip.style("opacity", 0);
}

function updateMapColors(year) {
    countryLayer.selectAll(".country")
        .style("fill", d => {
            const countryName = d.properties.name;
            
            // Use CA statewide data for the US shape unless the detail overlay is open
            if (countryName === "United States of America" && !isCaExpanded) {
                const caVal = caTempDataByYear[year];
                if (caVal !== undefined) return colorScale(caVal);
            }

            const history = countryDataByYear[countryName];
            const delta = history ? tempDelta(history, year) : undefined;
            return (delta !== undefined) ? colorScale(delta) : "#e0e0e0";
        });
    updateMiniMapColors(year);
    updateCityLayer();
    if (isCaExpanded && caGeoFeature) updateCaVisuals(year);
}

d3.select("#yearSlider").on("input", function() {
    currentYear = +this.value;
    d3.select("#yearLabel").text(currentYear);
    updateMapColors(currentYear);
});

function updateMiniMapColors(year) {
    const miniPath = d3.select("#mini-ca-path");
    if (miniPath.empty()) return;

    // Use the statewide average to color the mini-map
    const caVal = caTempDataByYear[year];
    
    // If we have data, color it; otherwise, default to gray
    const fillColor = (caVal !== undefined && !isNaN(caVal)) ? colorScale(caVal) : "#e0e0e0";
    
    miniPath.style("fill", fillColor);
}

function extractCaliforniaTemps(rows) {
    const acc = {};
    rows.forEach(d => {
        if (d.State !== "California" || !d.dt || !d.AverageTemperature) return;
        const year = parseInt(d.dt.split("-")[0], 10);
        const temp = parseFloat(d.AverageTemperature);
        if (!isNaN(year) && !isNaN(temp)) {
            if (!acc[year]) acc[year] = { sum: 0, count: 0 };
            acc[year].sum += temp;
            acc[year].count += 1;
        }
    });
    const out = {};
    Object.keys(acc).forEach(year => out[year] = acc[year].sum / acc[year].count);
    return out;
}

function aggregateCaliforniaSeaLevel(rows) {
    const acc = {};
    rows.forEach(d => {
        if (!d.Date || d.MeanSeaLevelAnomaly === undefined) return;
        const year = parseInt(d.Date.split("-")[0], 10);
        const anomaly = parseFloat(d.MeanSeaLevelAnomaly) * 1000; // meters to mm
        if (!isNaN(year) && !isNaN(anomaly)) {
            if (!acc[year]) acc[year] = { sum: 0, count: 0 };
            acc[year].sum += anomaly;
            acc[year].count += 1;
        }
    });
    const out = {};
    Object.keys(acc).forEach(year => out[year] = acc[year].sum / acc[year].count);
    return out;
}
function aggregateSeaStations(rows) {
    const stationMap = new Map();
    rows.forEach(d => {
        if (!d.Date || d.MeanSeaLevelAnomaly === undefined) return;
        const year = parseInt(d.Date.split("-")[0], 10);
        const anomaly = parseFloat(d.MeanSeaLevelAnomaly) * 1000; // meters to mm
        const lat = parseFloat(d.Latitude);
        const lon = parseFloat(d.Longitude);
        if (isNaN(year) || isNaN(anomaly)) return;

        if (!stationMap.has(d.Station)) {
            stationMap.set(d.Station, { station: d.Station, lat, lon, years: {} });
        }
        stationMap.get(d.Station).years[year] = anomaly;
    });
    return Array.from(stationMap.values());
}

// Small CA preview in the corner of the global map
function drawMiniMap() {
    const miniSvg = d3.select("#ca-mini-map-svg");
    miniSvg.selectAll("*").remove();
    
    const miniProj = d3.geoMercator().fitSize([120, 140], caGeoFeature);
    const miniPath = d3.geoPath().projection(miniProj);

    miniSvg.append("path")
        .datum(caGeoFeature)
        .attr("id", "mini-ca-path")
        .attr("d", miniPath)
        .style("fill", "#e0e0e0")
        .style("stroke", "#333")
        .style("stroke-width", "1px");
}

// Full-screen California map with zoomable county and city layers
function drawOverlayMap() {
    if (!caGeoFeature) return;
    const overlaySvg = d3.select("#ca-overlay-svg");
    overlaySvg.selectAll("*").remove();

    const rect = overlaySvg.node().getBoundingClientRect();
    const overlayWidth = rect.width || width;
    const overlayHeight = rect.height || height;
    overlaySvg.attr("viewBox", `0 0 ${overlayWidth} ${overlayHeight}`);

    const padding = 40;
    const overlayProj = d3.geoMercator().fitExtent(
        [[padding, padding], [overlayWidth - padding, overlayHeight - padding]], 
        caGeoFeature
    );
    const overlayPath = d3.geoPath().projection(overlayProj);

    const masterG = overlaySvg.append("g").attr("id", "ca-map-master");

    masterG.append("path")
        .datum(caGeoFeature)
        .attr("id", "giant-ca-path")
        .attr("d", overlayPath)
        .style("fill", "none")
        .style("stroke", "#333")
        .style("stroke-width", "2px");

    masterG.append("g").attr("id", "ca-overlay-counties");
    masterG.append("g").attr("id", "ca-overlay-cities");
    
    overlaySvg.node().__proj = overlayProj;
    setupCaZoom();
}

// Redraw county fills and station/city dots when year or mode changes
function updateCaVisuals(year) {
    if (!isCaExpanded) return;

    const safeYear = year || 2000; 
    const caSeaAnomaly = caSeaLevelDataByYear[safeYear];
    const overlaySvg = d3.select("#ca-overlay-svg");
    const overlayProj = overlaySvg.node().__proj;

    d3.select("#ca-sea-level-note").remove();

    // Sea level data only exists at coastal gauges, so warn the user
    if (caViewMode === 'sea') {
        d3.select("#ca-full-view")
            .append("div")
            .attr("id", "ca-sea-level-note")
            .style("background-color", "#fff3cd")
            .style("color", "#856404")
            .style("padding", "10px")
            .style("margin", "10px")
            .style("border", "1px solid #ffeeba")
            .style("border-radius", "4px")
            .style("font-size", "12px")
            .style("text-align", "center")
            .html("<strong>Note:</strong> Internal counties do not have specific sea level data. Visualized anomalies represent average trends recorded at coastal monitoring stations.");
    }

    if (!overlayProj) return;

    let countiesGroup = overlaySvg.select("#ca-overlay-counties");
    if (countiesGroup.empty()) {
        countiesGroup = overlaySvg.insert("g", "#ca-overlay-cities").attr("id", "ca-overlay-counties");
    }

    d3.select("#giant-ca-path").style("fill", "none");

    if (caCountiesGeoData) {
        const countyPaths = countiesGroup.selectAll("path.county")
            .data(caCountiesGeoData.features)
            .join("path")
            .attr("class", "county")
            .attr("d", d3.geoPath().projection(overlayProj))
            .style("fill", "#e0e0e0")
            .style("stroke", "#ffffff")
            .style("stroke-width", "0.5px");

        countyPaths.style("fill", d => {
            const countyName = d.properties.name;
            
            if (caViewMode === 'sea') {
                return (caSeaAnomaly !== undefined && !isNaN(caSeaAnomaly)) ? seaLevelColorScale(caSeaAnomaly) : "#e0e0e0";
            } else {
                const val = caCountyTempDataByYear[countyName]?.[safeYear];
                if (val !== undefined && !isNaN(val)) {
                    return colorScale(val);
                }
                return "#e0e0e0";
            }
        });

        countyPaths
            .on("mouseover", function(event, d) {
                const countyName = d.properties.name;
                if (caViewMode === 'temp') {
                    const val = caCountyTempDataByYear[countyName]?.[safeYear];
                    const valText = (val !== undefined && !isNaN(val)) ? `${val > 0 ? '+' : ''}${val.toFixed(2)}°C` : "No Data";
                    d3.select("#tooltip").style("opacity", 1)
                      .html(`<strong>${countyName} County</strong><br/>Year: ${safeYear}<br/>Δ Temp: ${valText}`);
                } else {
                    const valText = (caSeaAnomaly !== undefined && !isNaN(caSeaAnomaly)) ? `${caSeaAnomaly > 0 ? '+' : ''}${caSeaAnomaly.toFixed(1)} mm` : "No Data";
                    d3.select("#tooltip").style("opacity", 1)
                      .html(`<strong>California Coast (Avg)</strong><br/>Year: ${safeYear}<br/>Δ Sea Level: ${valText}`);
                }
            })
            .on("mousemove", moveTooltip)
            .on("mouseleave", hideTooltip);
    }

    let cityGroup = overlaySvg.select("#ca-overlay-cities");
    if (cityGroup.empty()) {
        cityGroup = overlaySvg.append("g").attr("id", "ca-overlay-cities");
    }
    
    cityGroup.raise();

    let activeDots = [];
    if (caViewMode === 'temp') {
        activeDots = caCitiesArray.map(c => {
            const val = tempDelta(c.years, safeYear);
            return {
                id: c.city, lat: c.lat, lon: c.lon, val: val,
                label: `<strong>${c.city}</strong><br/>Δ ${(val !== undefined && !isNaN(val)) ? (val > 0 ? '+' : '') + val.toFixed(2) + "°C" : "No Data"}`
            };
        });
    } else if (caViewMode === 'sea') {
        activeDots = caSeaStations.map(s => {
            const val = s.years[safeYear];
            return {
                id: s.station, lat: s.lat, lon: s.lon, val: val,
                label: `<strong>${s.station} Gauge</strong><br/>${(val !== undefined && !isNaN(val)) ? 'Δ ' + (val > 0 ? '+' : '') + val.toFixed(1) + ' mm' : '<i>Station Offline</i>'}`
            };
        });
    }

    const join = cityGroup.selectAll("circle.ca-overlay-city")
        .data(activeDots, d => d.id);

    join.exit().remove();

    join.enter()
        .append("circle")
        .attr("class", "ca-overlay-city city-point")
        .merge(join)
        .on("mouseover", (event, d) => {
            d3.select("#tooltip").style("opacity", 1).html(`${d.label}<br/>Year: ${safeYear}`);
        })
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip)
        .attr("cx", d => overlayProj([d.lon, d.lat])[0])
        .attr("cy", d => overlayProj([d.lon, d.lat])[1])
        .attr("r", 6) 
        .attr("fill", d => {
            if (d.val === undefined || isNaN(d.val)) return "#b0b0b0";
            return caViewMode === 'temp' ? colorScale(d.val) : seaLevelColorScale(d.val);
        })
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 1.5)
        .attr("opacity", d => (d.val !== undefined && !isNaN(d.val)) ? 1.0 : 0.3);
}

function setupCaZoom() {
    const overlaySvg = d3.select("#ca-overlay-svg");
    const masterG = overlaySvg.select("#ca-map-master");
    
    const caZoom = d3.zoom()
        .scaleExtent([1, 8])
        .on("zoom", (event) => {
            masterG.attr("transform", event.transform);
        });

    overlaySvg.call(caZoom);
}

// --- California overlay UI ---

d3.select("#ca-corner-panel").on("click", function() {
    if (!caGeoFeature) return;
    isCaExpanded = true;
    
    d3.select(this).style("display", "none");
    d3.select("#ca-full-view").style("display", "flex");

    drawOverlayMap(); 
    updateCaVisuals(currentYear);
    updateMapColors(currentYear);
});

d3.select("#btn-back-global").on("click", function() {
    isCaExpanded = false;
    caViewMode = 'temp';
    renderLegend('temp');
    d3.select("#ca-sea-level-note").remove();

    d3.select("#ca-full-view").style("display", "none");
    d3.select("#ca-corner-panel").style("display", "block");

    d3.selectAll(".toggle-group .ca-btn").classed("active-toggle", false);
    d3.select("#btn-toggle-temp").classed("active-toggle", true);
});

d3.select("#btn-toggle-temp").on("click", function() {
    caViewMode = 'temp';
    d3.selectAll(".toggle-group .ca-btn").classed("active-toggle", false);
    d3.select(this).classed("active-toggle", true);
    
    renderLegend('temp');
    updateCaVisuals(currentYear);
});

d3.select("#btn-toggle-sea").on("click", function() {
    caViewMode = 'sea';
    d3.selectAll(".toggle-group .ca-btn").classed("active-toggle", false);
    d3.select(this).classed("active-toggle", true);

    renderLegend('sea');
    updateCaVisuals(currentYear);
});