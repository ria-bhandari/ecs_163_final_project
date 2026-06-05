(function drawStateTemperatureChart() {
  const tempFile = "./alldatasets/GlobalLandTemperaturesByState.csv";

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
  const width = svgNode.clientWidth || 600;
  const height = svgNode.clientHeight || 300;

  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const margin = { top: 45, right: 95, bottom: 35, left: 55 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  d3.csv(tempFile).then(data => {
    const cleaned = data
      .filter(d =>
        d.Country === "United States" &&
        selectedStates.includes(d.State) &&
        d.AverageTemperature !== "" &&
        d.AverageTemperatureUncertainty !== "" &&
        d.dt !== ""
      )
      .map(d => ({
        state: d.State,
        year: new Date(d.dt).getFullYear(),
        temperature: +d.AverageTemperature,
        uncertainty: +d.AverageTemperatureUncertainty
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

    const dimensions = ["year", "temperature", "uncertainty"];

    const dimensionLabels = {
      year: "Year",
      temperature: "Avg Temp (°C)",
      uncertainty: "Uncertainty"
    };

    const x = d3.scalePoint()
      .domain(dimensions)
      .range([0, innerWidth])
      .padding(0.35);

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

    const tooltip = d3.select("#tooltip");

    const lines = g.append("g")
      .attr("class", "lines")
      .selectAll("path")
      .data(processedData)
      .enter()
      .append("path")
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", d => color(d.state))
      .attr("stroke-width", 1)
      .attr("opacity", 0.22)
      .on("mouseover", function(event, d) {
        d3.select(this)
          .attr("stroke-width", 2.8)
          .attr("opacity", 1);

        tooltip
          .style("opacity", 1)
          .html(`
            <strong>${d.state}</strong><br>
            Year: ${d.year}<br>
            Avg Temp: ${d.temperature.toFixed(2)}°C<br>
            Uncertainty: ${d.uncertainty.toFixed(2)}
          `);
      })
      .on("mousemove", function(event) {
        tooltip
          .style("left", event.pageX + 12 + "px")
          .style("top", event.pageY - 20 + "px");
      })
      .on("mouseout", function() {
        d3.select(this)
          .attr("stroke-width", 1)
          .attr("opacity", 0.22);

        tooltip.style("opacity", 0);
      });

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

    const axisGroups = g.selectAll(".dimension")
      .data(dimensions)
      .enter()
      .append("g")
      .attr("class", "dimension")
      .attr("transform", d => `translate(${x(d)},0)`);

    axisGroups.each(function(dim) {
      d3.select(this)
        .call(d3.axisLeft(y[dim]).ticks(5));
    });

    axisGroups.append("text")
      .attr("y", -14)
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "bold")
      .attr("fill", "black")
      .text(d => dimensionLabels[d]);

    axisGroups.append("g")
      .attr("class", "brush")
      .each(function(dim) {
        d3.select(this).call(
          d3.brushY()
            .extent([[-12, 0], [12, innerHeight]])
            .on("brush end", event => brush(event, dim))
        );
      });

    const legend = svg.append("g")
      .attr("transform", `translate(${width - 85},${margin.top})`);

    selectedStates.forEach((state, i) => {
      const item = legend.append("g")
        .attr("transform", `translate(0,${i * 18})`);

      item.append("rect")
        .attr("width", 10)
        .attr("height", 10)
        .attr("fill", color(state));

      item.append("text")
        .attr("x", 15)
        .attr("y", 9)
        .attr("font-size", "10px")
        .text(state);
    });
  });
})();