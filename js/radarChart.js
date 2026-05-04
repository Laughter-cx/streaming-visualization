(function (global) {
  var d3 = global.d3;
  var CONTAINER_ID = "radar-chart-container";
  var METRIC_KEYS = [
    { key: "avgRating", label: "内容评分" },
    { key: "count", label: "影片数量" },
    { key: "genreDiversity", label: "类型丰富度" },
    { key: "countryDiversity", label: "国家覆盖数" },
    { key: "highRatingRatio", label: "高分占比" },
  ];

  function computePlatformMetrics(data) {
    var grouped = d3.group(data, function (d) {
      return d.platform || "未知平台";
    });
    var rows = Array.from(grouped, function (entry) {
      var platform = entry[0];
      var list = entry[1];
      var ratingValues = list
        .map(function (r) {
          return r.rating;
        })
        .filter(function (v) {
          return typeof v === "number" && !isNaN(v);
        });
      var avgRating = ratingValues.length ? d3.mean(ratingValues) : 0;
      var genreSet = new Set();
      var countrySet = new Set();
      var highCnt = 0;
      list.forEach(function (r) {
        (r.genre || []).forEach(function (g) {
          if (g) genreSet.add(g);
        });
        var validCountry = r.country;
        var isUnknown =
          typeof global.isUnknownCategory === "function"
            ? global.isUnknownCategory(validCountry)
            : validCountry == null || String(validCountry).trim() === "" || String(validCountry) === "Unknown";
        if (!isUnknown) countrySet.add(validCountry);
        if (typeof r.rating === "number" && r.rating >= 7) highCnt += 1;
      });
      return {
        platform: platform,
        avgRating: avgRating,
        count: list.length,
        genreDiversity: genreSet.size,
        countryDiversity: countrySet.size,
        highRatingRatio: list.length ? highCnt / list.length : 0,
      };
    });
    return rows.sort(function (a, b) {
      return b.count - a.count;
    });
  }

  function normalizeRadarRows(rows) {
    if (!rows.length) return [];
    var minMax = {};
    METRIC_KEYS.forEach(function (m) {
      var values = rows.map(function (r) {
        return r[m.key];
      });
      minMax[m.key] = { min: d3.min(values), max: d3.max(values) };
    });
    return rows.map(function (r) {
      var normalized = {};
      METRIC_KEYS.forEach(function (m) {
        var lo = minMax[m.key].min;
        var hi = minMax[m.key].max;
        if (lo === hi) normalized[m.key] = 100;
        else normalized[m.key] = ((r[m.key] - lo) / (hi - lo)) * 100;
      });
      return { raw: r, normalized: normalized };
    });
  }

  function polygonPoints(centerX, centerY, radius, values) {
    var angleStep = (Math.PI * 2) / METRIC_KEYS.length;
    return METRIC_KEYS.map(function (m, i) {
      var angle = -Math.PI / 2 + i * angleStep;
      var rr = (values[m.key] / 100) * radius;
      return [centerX + Math.cos(angle) * rr, centerY + Math.sin(angle) * rr];
    });
  }

  function redrawRadarChart() {
    console.log("[radar] update called");
    if (!d3) return;
    var container = document.getElementById(CONTAINER_ID);
    console.log(
      "[radar] container",
      container,
      container ? container.clientWidth : null,
      container ? container.clientHeight : null
    );
    if (!container) return;
    var filters = typeof global.getFilters === "function" ? global.getFilters() : {};
    var data = typeof global.getFilteredData === "function" ? global.getFilteredData(filters) : [];
    console.log("[radar] filteredData length", data.length);
    container.innerHTML = "";
    if (!data.length) {
      container.innerHTML = '<p class="chart-empty-hint">当前筛选条件下暂无可对比的平台数据。</p>';
      return;
    }
    var metrics = computePlatformMetrics(data);
    console.log("[radar] platform metrics count", metrics.length);
    console.log("[radar] platform metrics top5", metrics.slice(0, 5));
    if (!metrics.length) {
      container.innerHTML = '<p class="chart-empty-hint">当前筛选条件下暂无可对比的平台数据。</p>';
      return;
    }
    var radarData = normalizeRadarRows(metrics).slice(0, 6);
    console.log("[radar] indicators", METRIC_KEYS.map(function (m) { return m.label; }));
    console.log("[radar] series data top5", radarData.slice(0, 5));
    var width = Math.max(420, container.clientWidth || 620);
    var height = Math.max(360, container.clientHeight || 420);
    var centerX = width * 0.36;
    var centerY = height * 0.54;
    var radius = Math.min(width, height) * 0.28;
    var levels = [20, 40, 60, 80, 100];
    var color = d3.scaleOrdinal(d3.schemeTableau10);

    var svg = d3
      .select(container)
      .append("svg")
      .attr("class", "radar-chart-svg")
      .attr("width", width)
      .attr("height", height);

    levels.forEach(function (lv) {
      var pts = polygonPoints(centerX, centerY, radius, {
        avgRating: lv,
        count: lv,
        genreDiversity: lv,
        countryDiversity: lv,
        highRatingRatio: lv,
      });
      svg
        .append("polygon")
        .attr("points", pts.map(function (p) { return p.join(","); }).join(" "))
        .attr("fill", "none")
        .attr("stroke", "#d5deea")
        .attr("stroke-width", 1);
    });

    METRIC_KEYS.forEach(function (m, i) {
      var angle = -Math.PI / 2 + (Math.PI * 2 * i) / METRIC_KEYS.length;
      var x = centerX + Math.cos(angle) * radius;
      var y = centerY + Math.sin(angle) * radius;
      svg
        .append("line")
        .attr("x1", centerX)
        .attr("y1", centerY)
        .attr("x2", x)
        .attr("y2", y)
        .attr("stroke", "#d5deea");
      svg
        .append("text")
        .attr("x", centerX + Math.cos(angle) * (radius + 18))
        .attr("y", centerY + Math.sin(angle) * (radius + 18))
        .attr("text-anchor", "middle")
        .attr("class", "radar-axis-label")
        .text(m.label);
    });

    var selectedPlatform = filters.selectedPlatform;
    radarData.forEach(function (item, idx) {
      var pts = polygonPoints(centerX, centerY, radius, item.normalized);
      var active = !selectedPlatform || selectedPlatform === item.raw.platform;
      svg
        .append("polygon")
        .attr("class", "radar-polygon")
        .attr("points", pts.map(function (p) { return p.join(","); }).join(" "))
        .attr("fill", color(idx))
        .attr("fill-opacity", active ? 0.28 : 0.08)
        .attr("stroke", color(idx))
        .attr("stroke-width", selectedPlatform === item.raw.platform ? 2.4 : 1.4)
        .style("cursor", "pointer")
        .on("mouseenter", function (event) {
          if (typeof global.showTooltip !== "function") return;
          global.showTooltip(
            {
              subtitle: "平台雷达指标",
              title: item.raw.platform,
              rating: item.raw.avgRating.toFixed(2),
              description: "点击可切换平台联动筛选",
              metrics: [
                { label: "影片数量", value: item.raw.count },
                { label: "类型丰富度", value: item.raw.genreDiversity },
                { label: "覆盖地区数", value: item.raw.countryDiversity },
                { label: "高分占比", value: (item.raw.highRatingRatio * 100).toFixed(1) + "%" },
              ],
            },
            event.pageX,
            event.pageY
          );
        })
        .on("mousemove", function (event) {
          if (typeof global.moveTooltip === "function") {
            global.moveTooltip(event.pageX, event.pageY);
          }
        })
        .on("mouseleave", function () {
          if (typeof global.hideTooltip === "function") global.hideTooltip();
        })
        .on("click", function (event) {
          event.stopPropagation();
          if (typeof global.updateFilters !== "function") return;
          var nextPlatform =
            selectedPlatform === item.raw.platform ? null : item.raw.platform;
          global.updateFilters({ selectedPlatform: nextPlatform, sourceChart: "radar" });
        });
    });

    var legendX = width * 0.66;
    var legendY = 34;
    var legend = svg.append("g").attr("transform", "translate(" + legendX + "," + legendY + ")");
    radarData.forEach(function (item, idx) {
      var y = idx * 22;
      var active = !selectedPlatform || selectedPlatform === item.raw.platform;
      legend
        .append("rect")
        .attr("x", 0)
        .attr("y", y - 9)
        .attr("width", 12)
        .attr("height", 12)
        .attr("fill", color(idx))
        .attr("opacity", active ? 1 : 0.4);
      legend
        .append("text")
        .attr("x", 18)
        .attr("y", y)
        .attr("alignment-baseline", "middle")
        .attr("class", "radar-legend-text")
        .text(item.raw.platform);
    });
  }

  function initRadarChart() {
    console.log("[radar] init called");
    var container = document.getElementById(CONTAINER_ID);
    console.log(
      "[radar] init container",
      container,
      container ? container.clientWidth : null,
      container ? container.clientHeight : null
    );
    if (!container) return;
  }

  global.initRadarChart = initRadarChart;
  global.redrawRadarChart = redrawRadarChart;
})(typeof window !== "undefined" ? window : globalThis);
