(function drawSeaLevelChart() {
  const svg = d3.select("#sea-level-svg");

    const files = [
    { region: "Atlantic Ocean", file: "alldatasets/slr_sla_atl_free_all_66.csv" },
    { region: "Caribbean Sea", file: "alldatasets/slr_sla_crs_free_all_66.csv" },
    { region: "Indian Ocean", file: "alldatasets/slr_sla_ind_free_all_66.csv" },
    { region: "Mediterranean Sea", file: "alldatasets/slr_sla_mds_free_all_66.csv" },
    { region: "North Atlantic Ocean", file: "alldatasets/slr_sla_na_free_all.csv" },
    { region: "North Pacific Ocean", file: "alldatasets/slr_sla_np_free_all.csv" },
    { region: "Pacific Ocean", file: "alldatasets/slr_sla_pac_free_all_66.csv" },
    { region: "Southern Ocean", file: "alldatasets/slr_sla_so_free_all.csv" }
    ];


  const svgNode = svg.node();
  const width = svgNode.clientWidth;
  const height = svgNode.clientHeight;
  svg.attr("width", width).attr("height", height);

  const margin = { top: 60, right: 180, bottom: 60, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  function loadCleanCSV(file, region) {
    return d3.text(file).then(text => {
      const cleanText = text
        .split("\n")
        .filter(line => line.trim() !== "" && !line.trim().startsWith("#"))
        .join("\n");

      const rows = d3.csvParseRows(cleanText);
      
      return rows.map(row => {
      const year = Math.floor(+row[0]);

      const value = row
          .slice(1)
          .map(v => +v)
          .find(v => !isNaN(v));

      return {
          region: region,
          year: year,
          value: value
      };

      }).filter(d => !isNaN(d.year) && !isNaN(d.value));

    });
  }

  Promise.all(files.map(d => loadCleanCSV(d.file, d.region))).then(allData => {
    const combined = allData.flat();

    const years = [...new Set(combined.map(d => d.year))]
    .sort((a, b) => a - b);
    const regions = files.map(d => d.region);

    const wideData = years.map(year => {
      const row = { year };

      regions.forEach(region => {
        const values = combined.filter(d => d.year === year && d.region === region);
        row[region] = d3.mean(values, d => d.value) || 0;
      });

      return row;
    });

    const stack = d3.stack()
      .keys(regions)
      .offset(d3.stackOffsetNone)
      .order(d3.stackOrderInsideOut);

    const series = stack(wideData);

    const x = d3.scaleLinear()
        .domain([1992, 2008])
        .range([0, innerWidth]);

    const y = d3.scaleLinear()
        .domain([-160, 80])
        .range([innerHeight, 0])
        .range([innerHeight, 0]);

    const color = d3.scaleOrdinal()
      .domain(regions)
      .range(d3.schemeCategory10);

    const area = d3.area()
      .x(d => x(d.data.year))
      .y0(d => y(d[0]))
      .y1(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    g.selectAll(".layer")
      .data(series)
      .enter()
      .append("path")
      .attr("class", "layer")
      .attr("d", area)
      .style("fill", d => color(d.key))
      .style("opacity", 0.85)

      .on("mouseover", function(event, d) {
        d3.selectAll(".layer").style("opacity", 0.25);
        d3.select(this).style("opacity", 1);
      })

      .on("mouseout", function() {
        d3.selectAll(".layer").style("opacity", 0.85);
      })

      .on("click", function(event, d) {
        const region = d.key;
        const values = combined.filter(row => row.region === region);

        const avg = d3.mean(values, row => row.value);
        const max = d3.max(values, row => row.value);
        const min = d3.min(values, row => row.value);

        d3.selectAll(".layer").style("opacity", 0.25);
        d3.select(this).style("opacity", 1);

        d3.select("#sea-floating-info")
          .style("display", "block")
          .html(`
            <strong>${region}</strong><br>
            Avg: ${avg.toFixed(2)} mm<br>
            Max: ${max.toFixed(2)} mm<br>
            Min: ${min.toFixed(2)} mm
          `);
      });

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")));

    g.append("text")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 45)
      .attr("text-anchor", "middle")
      .text("Year")
      .attr("font-size", "18px");

    g.append("g")
      .call(d3.axisLeft(y));

    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerHeight / 2)
      .attr("y", -50)
      .attr("text-anchor", "middle")
      .attr("font-size", "16px")
      .text("Sea Level Anomaly (mm)");

    g.append("text")
      .attr("x", innerWidth / 2)
      .attr("y", -20)
      .attr("text-anchor", "middle")
      .attr("font-size", "30px")
      .attr("font-weight", "bold")

    const legend = svg.append("g")
      .attr("transform", `translate(${width - 200},80)`);

    regions.forEach((region, i) => {
      const item = legend.append("g")
        .attr("transform", `translate(0,${i * 25})`);

      item.append("rect")
        .attr("width", 12)
        .attr("height", 12)
        .attr("fill", color(region));

      item.append("text")
        .attr("x", 29)
        .attr("y", 12)
        .style("font-size", "12px")
        .text(region);
    });
  });

})();
