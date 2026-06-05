const tempFile = "./temperatureandsea/GlobalLandTemperaturesByState.csv";

const selectedStates = [
  "California",
  "Texas",
  "Florida",
  "New York",
  "Pennsylvania",
  "Illinois",
  "Ohio",
  "Georgia"
];

const svg = d3.select("#advanced-chart-svg");

const svgNode = svg.node();
const width = svgNode.clientWidth;
const height = svgNode.clientHeight;

svg.selectAll("*").remove();

svg.attr("viewBox", `0 0 ${width} ${height}`);

const margin = { top: 60, right: 180, bottom: 50, left: 70 };

const innerWidth = width - margin.left - margin.right;
const innerHeight = height - margin.top - margin.bottom;

const g = svg.append("g")
  .attr("transform", `translate(${margin.left},${margin.top})`);

d3.csv(tempFile).then(data => {
  const cleaned = data
    .filter(d =>
      selectedStates.includes(d.State) &&
      d.AverageTemperature !== "" &&
      d.AverageTemperatureUncertainty !== "" &&
      d.dt !== ""
    )
    .map(d => ({
      state: d.State,
      year: new Date(d.dt).getFullYear(),
      temperature: +d.AverageTemperature,
      uncertainty: +d.AverageTemperatureUncertainty,
    }))
    .filter(d =>
      !isNaN(d.year) &&
      !isNaN(d.temperature) &&
      !isNaN(d.uncertainty) &&
      d.year >= 1900 &&
      d.year <= 2012
    );

  const grouped = d3.rollups(
    cleaned,
    values => ({
      state: values[0].state,
      year: values[0].year,
      temperature: d3.mean(values, d => d.temperature),
      uncertainty: d3.mean(values, d => d.uncertainty)
      // latitude: d3.mean(values, d => d.latitude),
      // longitude: d3.mean(values, d => d.longitude)
    }),
    d => d.state,
    d => d.year
  );

  const processedData = [];

  grouped.forEach(([state, years]) => {
    years.forEach(([year, values]) => {
      processedData.push(values);
    });
  });

  const dimensions = [
    "year",
    "temperature",
    "uncertainty"
  ];

  const dimensionLabels = {
    year: "Year",
    temperature: "Avg Temp (°C)",
    uncertainty: "Uncertainty",
    // latitude: "Latitude",
    // longitude: "Longitude"
  };

  const x = d3.scalePoint()
    .domain(dimensions)
    .range([0, innerWidth])
    .padding(0.4);

  const y = {};

  dimensions.forEach(dim => {
    y[dim] = d3.scaleLinear()
      .domain(d3.extent(processedData, d => d[dim]))
      .nice()
      .range([innerHeight, 0]);
  });

  const color = d3.scaleOrdinal()
    .domain(selectedStates)
    .range(d3.schemeCategory10);

  function path(d) {
    return d3.line()(dimensions.map(dim => [x(dim), y[dim](d[dim])]));
  }

  // Tooltip
  const tooltip = d3.select("body")
    .append("div")
    .style("position", "absolute")
    .style("padding", "8px 10px")
    .style("background", "white")
    .style("border", "1px solid #999")
    .style("border-radius", "6px")
    .style("font-size", "13px")
    .style("pointer-events", "none")
    .style("opacity", 0);

  const lines = g.append("g")
    .attr("class", "lines")
    .selectAll("path")
    .data(processedData)
    .enter()
    .append("path")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", d => color(d.state))
    .attr("stroke-width", 1.2)
    .attr("opacity", 0.25)
    .on("mouseover", function(event, d) {
      d3.select(this)
        .attr("stroke-width", 3)
        .attr("opacity", 1);

      tooltip
        .style("opacity", 1)
        .html(`
          <strong>${d.state}</strong><br>
          Year: ${d.year}<br>
          Avg Temp: ${d.temperature.toFixed(2)}°C<br>
          Uncertainty: ${d.uncertainty.toFixed(2)}<br>
          // Lat: ${d.latitude.toFixed(2)}<br>
          // Long: ${d.longitude.toFixed(2)}
        `);
    })
    .on("mousemove", function(event) {
      tooltip
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 20 + "px");
    })
    .on("mouseout", function() {
      d3.select(this)
        .attr("stroke-width", 1.2)
        .attr("opacity", 0.25);

      tooltip.style("opacity", 0);
    });

  // Brushing logic
  const activeBrushes = {};

  function brush(event, dim) {
    if (event.selection) {
      activeBrushes[dim] = event.selection.map(y[dim].invert);
    } else {
      delete activeBrushes[dim];
    }

    lines.style("display", d => {
      return dimensions.every(dim => {
        if (!activeBrushes[dim]) return true;

        const [max, min] = activeBrushes[dim];
        return d[dim] >= min && d[dim] <= max;
      }) ? null : "none";
    });
  }

  // Draw each vertical axis
  const axisGroups = g.selectAll(".dimension")
    .data(dimensions)
    .enter()
    .append("g")
    .attr("class", "dimension")
    .attr("transform", d => `translate(${x(d)},0)`);

  axisGroups.each(function(dim) {
    d3.select(this)
      .call(d3.axisLeft(y[dim]));
  });

  axisGroups.append("text")
    .attr("y", -15)
    .attr("text-anchor", "middle")
    .attr("font-size", "14px")
    .attr("font-weight", "bold")
    .attr("fill", "black")
    .text(d => dimensionLabels[d]);

  // Add brushes to each axis
  axisGroups.append("g")
    .attr("class", "brush")
    .each(function(dim) {
      d3.select(this).call(
        d3.brushY()
          .extent([[-12, 0], [12, innerHeight]])
          .on("brush end", event => brush(event, dim))
      );
    });

  // Title
  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 40)
    .attr("text-anchor", "middle")
    .attr("font-size", "28px")
    .attr("font-weight", "bold")

  // Subtitle / instructions
  svg.append("text")
    .attr("x", 350)
    .attr("y", 68)
    .attr("text-anchor", "middle")
    .attr("font-size", "15px")

  // Legend
  const legend = svg.append("g")
    .attr("transform", `translate(${width - 190},100)`);

  selectedStates.forEach((state, i) => {
    const item = legend.append("g")
      .attr("transform", `translate(0,${i * 28})`);

    item.append("rect")
      .attr("width", 16)
      .attr("height", 16)
      .attr("fill", color(state));

    item.append("text")
      .attr("x", 24)
      .attr("y", 13)
      .attr("font-size", "14px")
      .text(state);
  });
});
