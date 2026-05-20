// 1. Setup dimensions and responsive SVG container
const container = d3.select("#map-container");
const width = container.node().getBoundingClientRect().width;
const height = container.node().getBoundingClientRect().height;

const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height);

// Clear background rectangle to capture clicks on the ocean (for resetting zoom)
svg.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "transparent")
    .on("click", resetZoom);

const mapGroup = svg.append("g");
const tooltip = d3.select("#tooltip");

// 2. Map projection and path engine (Centered & Scaled)
const projection = d3.geoMercator()
    .scale(width / 5.5)
    .center([0, 35])
    .translate([width / 2, height / 2]);

const pathGenerator = d3.geoPath().projection(projection);

// 3. True-Scale Temperature Color Mapper
const colorScale = d3.scaleSequential()
    .domain([-10, 30]) 
    .interpolator(d3.interpolateReds);

// 4. Implement Zoom and Pan
const zoomBehavior = d3.zoom()
    .scaleExtent([1, 12]) // Limits how far you can zoom
    .on("zoom", (event) => {
        mapGroup.attr("transform", event.transform);
    });

svg.call(zoomBehavior);

// Global state variables
let countryDataByYear = {};
let activeCountry = d3.select(null); 
let currentYear = 2000; // Track active year slider state globally

// 5. Load Data
Promise.all([
    d3.json("https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"),
    d3.csv("data/temperature/GlobalLandTemperaturesByCountry.csv")
]).then(([geoData, rawCsvData]) => {

    // --- ACCELERATED DATA PARSING & AGGREGATION LOOP ---
    const tempAccumulator = {};
    rawCsvData.forEach(d => {
        if (!d.dt || !d.AverageTemperature || !d.Country) return;

        const year = parseInt(d.dt.split("-")[0]);
        const temp = parseFloat(d.AverageTemperature);
        let country = d.Country;

        // Name standardizations
        if (country === "United States") country = "United States of America";
        if (country === "Congo (Democratic Republic of the)") country = "Democratic Republic of the Congo";

        if (!isNaN(year) && !isNaN(temp)) {
            if (!tempAccumulator[country]) tempAccumulator[country] = {};
            if (!tempAccumulator[country][year]) tempAccumulator[country][year] = { sum: 0, count: 0 };

            tempAccumulator[country][year].sum += temp;
            tempAccumulator[country][year].count += 1;
        }
    });

    Object.keys(tempAccumulator).forEach(country => {
        countryDataByYear[country] = {};
        Object.keys(tempAccumulator[country]).forEach(year => {
            const data = tempAccumulator[country][year];
            countryDataByYear[country][year] = data.sum / data.count;
        });
    });

    // 6. Draw the country shapes and bind interaction triggers
    mapGroup.selectAll("path")
        .data(geoData.features)
        .join("path")
        .attr("class", "country")
        .attr("d", pathGenerator)
        .on("click", clickedCountry) // Click to zoom event
        .on("mouseover", showTooltip) // Hover event start
        .on("mousemove", moveTooltip) // Hover event position tracking
        .on("mouseleave", hideTooltip); // Hover event end

    updateMapColors(currentYear);

}).catch(err => console.error("Error setting up map framework:", err));

// 7. Click to Zoom function
function clickedCountry(event, d) {
    // If you click the same country that is already zoomed in, reset map view
    if (activeCountry.node() === this) return resetZoom();

    activeCountry.classed("active", false);
    activeCountry = d3.select(this).classed("active", true);

    // Calculate bounding coordinates of the selected country polygon
    const [[x0, y0], [x1, y1]] = pathGenerator.bounds(d);
    event.stopPropagation();

    // Direct transition vector instructions
    svg.transition().duration(750).call(
        zoomBehavior.transform,
        d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(Math.min(8, 0.85 / Math.max((x1 - x0) / width, (y1 - y0) / height)))
            .translate(-(x0 + x1) / 2, -(y0 + y1) / 2)
    );
}

// Reset view back to global scale
function resetZoom() {
    activeCountry.classed("active", false);
    activeCountry = d3.select(null);

    svg.transition().duration(750).call(
        zoomBehavior.transform,
        d3.zoomIdentity // Returns map translation back to baseline matrix
    );
}

// 8. Tooltip Handlers
function showTooltip(event, d) {
    const countryName = d.properties.name;
    const temp = countryDataByYear[countryName]?.[currentYear];
    const formattedTemp = temp !== undefined ? temp.toFixed(2) + "°C" : "No Data";

    tooltip.style("opacity", 1)
        .html(`<strong>${countryName}</strong><br/>Year: ${currentYear}<br/>Avg Temp: ${formattedTemp}`);
}

function moveTooltip(event) {
    // Offset the coordinates slightly from your mouse cursor so it follows nicely
    tooltip.style("left", (event.pageX + 15) + "px")
           .style("top", (event.pageY - 15) + "px");
}

function hideTooltip() {
    tooltip.style("opacity", 0);
}

// 9. Core Update Loop
function updateMapColors(year) {
    mapGroup.selectAll(".country")
        .transition()
        .duration(100)
        .style("fill", d => {
            const countryName = d.properties.name;
            const history = countryDataByYear[countryName];
            if (history && history[year] !== undefined) {
                return colorScale(history[year]);
            }
            return "#e5e5e5";
        });
}

// 10. Slider Event Listener
d3.select("#yearSlider").on("input", function() {
    currentYear = +this.value;
    d3.select("#yearLabel").text(currentYear);
    updateMapColors(currentYear);
});