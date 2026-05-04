(function (global) {
  var d3 = global.d3;
  var CONTAINER_ID = "new-radar-chart-container";
  var tooltipEl = null;
  var CHART_BODY_HEIGHT = 420;

  var PLATFORM_COLORS = {
    Netflix: "#e50914",
    "Disney+": "#6b5cff",
    "Amazon Prime": "#146eb4",
  };

  var RADAR_AXES = [
    "Action",
    "Comedy",
    "Drama",
    "Documentary",
    "Horror",
    "Thriller",
    "International",
    "Other",
  ];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function genreTags(record) {
    var value = record.listed_in || record.genre || record.genres || "";
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value)
      .split(",")
      .map(function (tag) {
        return tag.trim();
      })
      .filter(Boolean);
  }

  function bucketGenre(tag) {
    var text = String(tag || "").toLowerCase();
    if (/action|adventure/.test(text)) return "Action";
    if (/comedy|comedies/.test(text)) return "Comedy";
    if (/drama|dramas/.test(text)) return "Drama";
    if (/documentar/.test(text)) return "Documentary";
    if (/horror/.test(text)) return "Horror";
    if (/thriller/.test(text)) return "Thriller";
    if (/international/.test(text)) return "International";
    return "Other";
  }

  function normalizeImportedRadarRows(records) {
    return (records || [])
      .filter(function (raw) {
        var country = raw.country || raw.production_country || raw.countries;
        if (typeof global.isUnknownCategory === "function") {
          return !global.isUnknownCategory(country);
        }
        return country != null && String(country).trim().toLowerCase() !== "unknown";
      })
      .map(function (raw) {
        return {
          platform: raw.platform || raw.source_platform || "未知平台",
          listed_in: raw.listed_in || raw.genre || raw.genres || "",
        };
      });
  }

  function buildImportedRadarSeries(records) {
    var series = {};
    normalizeImportedRadarRows(records).forEach(function (row) {
      if (!series[row.platform]) {
        series[row.platform] = {};
        RADAR_AXES.forEach(function (axis) {
          series[row.platform][axis] = 0;
        });
      }
      var tags = genreTags(row);
      if (!tags.length) {
        series[row.platform].Other += 1;
        return;
      }
      var weight = 1 / tags.length;
      tags.forEach(function (tag) {
        var bucket = bucketGenre(tag);
        series[row.platform][bucket] += weight;
      });
    });

    Object.keys(series).forEach(function (platform) {
      var total = RADAR_AXES.reduce(function (sum, axis) {
        return sum + series[platform][axis];
      }, 0) || 1;
      RADAR_AXES.forEach(function (axis) {
        series[platform][axis] = series[platform][axis] / total;
      });
    });
    return series;
  }

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = d3
      .select("body")
      .append("div")
      .attr("class", "new-radar-chart-tooltip")
      .style("opacity", 0);
    return tooltipEl;
  }

  function updateNewRadarChart(filters) {
    if (!d3) return;
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;
    var currentFilters = filters || (typeof global.getFilters === "function" ? global.getFilters() : {});
    var records =
      typeof global.getFilteredRawRecords === "function"
        ? global.getFilteredRawRecords(currentFilters)
        : [];
    var series = buildImportedRadarSeries(records);
    var platforms = Object.keys(series).sort(function (a, b) {
      var totalA = RADAR_AXES.reduce(function (sum, axis) { return sum + series[a][axis]; }, 0);
      var totalB = RADAR_AXES.reduce(function (sum, axis) { return sum + series[b][axis]; }, 0);
      return totalB - totalA;
    });

    container.innerHTML = "";
    if (!platforms.length) {
      container.innerHTML = '<p class="chart-empty-hint">当前筛选条件下暂无可对比的类型数据。</p>';
      return;
    }

    var width = Math.max(420, container.clientWidth || 620);
    var height = CHART_BODY_HEIGHT;
    var centerX = width * 0.42;
    var centerY = height * 0.52;
    var radius = Math.min(width, height) * 0.3;
    var angleStep = (Math.PI * 2) / RADAR_AXES.length;
    var tip = ensureTooltip();

    var svg = d3
      .select(container)
      .append("svg")
      .attr("class", "new-radar-chart-svg")
      .attr("width", width)
      .attr("height", height);

    var g = svg.append("g").attr("transform", "translate(" + centerX + "," + centerY + ")");

    [0.25, 0.5, 0.75, 1].forEach(function (level) {
      g.append("circle")
        .attr("r", radius * level)
        .attr("fill", "none")
        .attr("stroke", "#d5deea")
        .attr("stroke-width", 1);
    });

    RADAR_AXES.forEach(function (axis, i) {
      var angle = i * angleStep - Math.PI / 2;
      g.append("line")
        .attr("x1", 0)
        .attr("y1", 0)
        .attr("x2", Math.cos(angle) * radius)
        .attr("y2", Math.sin(angle) * radius)
        .attr("stroke", "#d5deea");
      g.append("text")
        .attr("x", Math.cos(angle) * (radius + 20))
        .attr("y", Math.sin(angle) * (radius + 20))
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("class", "new-radar-chart-axis-label")
        .text(axis);
    });

    var line = d3
      .lineRadial()
      .angle(function (_, i) {
        return i * angleStep - Math.PI / 2;
      })
      .radius(function (value) {
        return value * radius;
      })
      .curve(d3.curveLinearClosed);

    platforms.slice(0, 6).forEach(function (platform, idx) {
      var values = RADAR_AXES.map(function (axis) {
        return series[platform][axis] || 0;
      });
      var selectedPlatform = currentFilters.selectedPlatform;
      var active = !selectedPlatform || selectedPlatform === platform;
      var color = PLATFORM_COLORS[platform] || d3.schemeTableau10[idx % 10];
      g.append("path")
        .datum(values)
        .attr("class", "new-radar-chart-polygon")
        .attr("d", line)
        .attr("fill", color)
        .attr("fill-opacity", active ? 0.18 : 0.05)
        .attr("stroke", color)
        .attr("stroke-width", selectedPlatform === platform ? 2.6 : 1.6)
        .style("cursor", "pointer")
        .on("mousemove", function (event) {
          tip
            .style("opacity", 1)
            .html(
              '<div class="new-radar-chart-tooltip__title">' +
                escapeHtml(platform) +
                "</div>" +
                RADAR_AXES.map(function (axis, axisIdx) {
                  return (
                    '<div class="new-radar-chart-tooltip__row">' +
                    escapeHtml(axis) +
                    ": " +
                    (values[axisIdx] * 100).toFixed(1) +
                    "%</div>"
                  );
                }).join("")
            )
            .style("left", event.clientX + 12 + "px")
            .style("top", event.clientY + 12 + "px");
        })
        .on("mouseleave", function () {
          tip.style("opacity", 0);
        })
        .on("click", function (event) {
          event.stopPropagation();
          if (typeof global.updateFilters !== "function") return;
          var latestFilters = typeof global.getFilters === "function" ? global.getFilters() : currentFilters;
          global.updateFilters({
            selectedPlatform: latestFilters.selectedPlatform === platform ? null : platform,
            sourceChart: "newRadarChart",
            sourceView: "newRadarChart",
            action: "togglePlatform",
          });
        });
    });

    var legend = svg.append("g").attr("transform", "translate(" + width * 0.72 + ",32)");
    platforms.slice(0, 6).forEach(function (platform, idx) {
      var selectedPlatform = currentFilters.selectedPlatform;
      var active = !selectedPlatform || selectedPlatform === platform;
      var color = PLATFORM_COLORS[platform] || d3.schemeTableau10[idx % 10];
      var row = legend.append("g").attr("transform", "translate(0," + idx * 22 + ")");
      row.append("rect")
        .attr("width", 12)
        .attr("height", 12)
        .attr("fill", color)
        .attr("opacity", active ? 1 : 0.35);
      row.append("text")
        .attr("x", 18)
        .attr("y", 10)
        .attr("class", "new-radar-chart-legend-text")
        .text(platform);
    });
  }

  function initNewRadarChart() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;
  }

  global.initNewRadarChart = initNewRadarChart;
  global.renderNewRadarChart = updateNewRadarChart;
  global.updateNewRadarChart = updateNewRadarChart;
  global.redrawNewRadarChart = function () {
    updateNewRadarChart();
  };
})(typeof window !== "undefined" ? window : globalThis);
