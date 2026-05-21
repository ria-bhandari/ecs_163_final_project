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

let countryDataByYear = {};
let cities = [];
let geoData = null;
let activeCountry = d3.select(null);
let currentYear = 2000;
let currentTransform = d3.zoomIdentity;

const zoomBehavior = d3.zoom()
    .scaleExtent([1, 14])
    .on("zoom", (event) => {
        currentTransform = event.transform;
        mapGroup.attr("transform", event.transform);
        updateCityLayer();
    });

svg.call(zoomBehavior);

drawColorbar();

Promise.all([
    d3.json("https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"),
    d3.csv("data/temperature/GlobalLandTemperaturesByCountry.csv"),
    d3.csv("data/temperature/GlobalLandTemperaturesByMajorCity.csv")
]).then(([geo, rawCountryData, rawCityData]) => {
    geoData = geo;
    projection.fitExtent(
        [[MAP_PADDING, MAP_PADDING], [width - MAP_PADDING, height - MAP_PADDING]],
        geoData
    );
    pathGenerator.projection(projection);

    countryDataByYear = aggregateCountryTemps(rawCountryData);
    cities = aggregateCityTemps(rawCityData);
    
    countryLayer.selectAll("path")
        .data(geoData.features)
        .join("path")
        .attr("class", "country")
        .attr("d", pathGenerator)
        .on("click", clickedCountry)
        .on("mouseover", showCountryTooltip)
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip);

    updateMapColors(currentYear);
}).catch(err => {
    console.error("Error setting up map:", err);
    container.append("p")
        .attr("class", "map-error")
        .text("Map failed to load. Use a local server (e.g. python3 -m http.server) and check the browser console.");
});

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

function drawColorbar() {
    const barWidth = 26;
    const barHeight = 220;
    const marginTop = 10;
    const [lo, , hi] = DELTA_DOMAIN;

    const legendSvg = d3.select("#colorbar-svg")
        .attr("width", barWidth + 44)
        .attr("height", barHeight + marginTop + 10);

    const defs = legendSvg.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "temp-gradient")
        .attr("x1", "0%")
        .attr("y1", "100%")
        .attr("x2", "0%")
        .attr("y2", "0%");

    const steps = 24;
    for (let i = 0; i <= steps; i++) {
        const val = lo + (i / steps) * (hi - lo);
        gradient.append("stop")
            .attr("offset", `${(i / steps) * 100}%`)
            .attr("stop-color", colorScale(val));
    }

    legendSvg.append("rect")
        .attr("x", 0)
        .attr("y", marginTop)
        .attr("width", barWidth)
        .attr("height", barHeight)
        .attr("rx", 3)
        .style("fill", "url(#temp-gradient)");

    const axisScale = d3.scaleLinear()
        .domain([lo, hi])
        .range([barHeight + marginTop, marginTop]);

    legendSvg.append("g")
        .attr("transform", `translate(${barWidth}, 0)`)
        .call(d3.axisRight(axisScale).ticks(5).tickFormat(d => {
            if (d === 0) return "0";
            return (d > 0 ? "+" : "") + d.toFixed(1);
        }));
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
    //hardcoded usa to prevent strange zooming
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
        .transition()
        .duration(100)
        .style("fill", d => {
            const countryName = d.properties.name;
            const history = countryDataByYear[countryName];
            const delta = history ? tempDelta(history, year) : undefined;
            if (delta !== undefined) {
                return colorScale(delta);
            }
            return "#e0e0e0";
        });

    updateCityLayer();
}

d3.select("#yearSlider").on("input", function() {
    currentYear = +this.value;
    d3.select("#yearLabel").text(currentYear);
    updateMapColors(currentYear);
});
