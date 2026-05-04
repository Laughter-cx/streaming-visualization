(function (global) {
  var L = global.L;
  var CONTAINER_ID = "new-bubble-chart-container";
  var mapInstance = null;
  var mapLayerGroup = null;

  var PLATFORM_COLORS = {
    Netflix: "#e50914",
    "Disney+": "#6b5cff",
    "Amazon Prime": "#146eb4",
  };

  var COUNTRY_CENTROIDS = {
    "United States": [39.8283, -98.5795],
    "United Kingdom": [54.7023, -3.2766],
    Canada: [56.1304, -106.3468],
    India: [20.5937, 78.9629],
    France: [46.2276, 2.2137],
    Japan: [36.2048, 138.2529],
    Germany: [51.1657, 10.4515],
    "South Korea": [35.9078, 127.7669],
    Australia: [-25.2744, 133.7751],
    Mexico: [23.6345, -102.5528],
    Spain: [40.4637, -3.7492],
    Italy: [41.8719, 12.5674],
    Brazil: [-14.235, -51.9253],
    Argentina: [-38.4161, -63.6167],
    "South Africa": [-30.5595, 22.9375],
    Russia: [61.524, 105.3188],
    Turkey: [38.9637, 35.2433],
    Egypt: [26.8206, 30.8025],
    Nigeria: [9.082, 8.6753],
    China: [35.8617, 104.1954],
    Thailand: [15.87, 100.9925],
    Indonesia: [-0.7893, 113.9213],
    Philippines: [12.8797, 121.774],
    Colombia: [4.5709, -74.2973],
    Chile: [-35.6751, -71.543],
    Peru: [-9.19, -75.0152],
    Poland: [51.9194, 19.1451],
    Sweden: [60.1282, 18.6435],
    Norway: [60.472, 8.4689],
    Denmark: [56.2639, 9.5018],
    Finland: [61.9241, 25.7482],
    Netherlands: [52.1326, 5.2913],
    Belgium: [50.5039, 4.4699],
    Ireland: [53.4129, -8.2439],
    Portugal: [39.3999, -8.2245],
    Austria: [47.5162, 14.5501],
    Switzerland: [46.8182, 8.2275],
    Israel: [31.0461, 34.8516],
    "United Arab Emirates": [23.4241, 53.8478],
    "Saudi Arabia": [23.8859, 45.0792],
    Morocco: [31.7917, -7.0926],
    Ghana: [7.9465, -1.0232],
    Ethiopia: [9.145, 40.4897],
  };

  function isKnownCountry(value) {
    if (typeof global.isUnknownCategory === "function") {
      return !global.isUnknownCategory(value);
    }
    return value != null && String(value).trim().toLowerCase() !== "unknown";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function splitCountries(value) {
    if (value == null) return [];
    return String(value)
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(isKnownCountry);
  }

  function normalizeImportedBubbleRows(records) {
    return (records || []).map(function (raw) {
      return {
        title: raw.title || raw.name || "未知片名",
        platform: raw.platform || raw.source_platform || "未知平台",
        country: raw.country || raw.production_country || raw.countries || "Unknown",
        rating: raw.rating || raw.content_rating || raw.maturity_rating || "暂无",
      };
    });
  }

  function aggregateImportedBubbleRows(records) {
    var agg = new Map();
    normalizeImportedBubbleRows(records).forEach(function (row) {
      splitCountries(row.country).forEach(function (country) {
        if (!COUNTRY_CENTROIDS[country]) return;
        if (!agg.has(country)) {
          agg.set(country, {
            country: country,
            count: 0,
            ratingCounts: {},
            platformCounts: {},
            sample: row,
          });
        }
        var bucket = agg.get(country);
        bucket.count += 1;
        if (row.rating && row.rating !== "暂无") {
          bucket.ratingCounts[row.rating] = (bucket.ratingCounts[row.rating] || 0) + 1;
        }
        bucket.platformCounts[row.platform] = (bucket.platformCounts[row.platform] || 0) + 1;
        if (!bucket.sample || row.rating !== "暂无") {
          bucket.sample = row;
        }
      });
    });
    return Array.from(agg.values());
  }

  function dominantPlatform(row) {
    var bestPlatform = row.sample.platform;
    var bestCount = -1;
    Object.keys(row.platformCounts).forEach(function (platform) {
      if (row.platformCounts[platform] > bestCount) {
        bestPlatform = platform;
        bestCount = row.platformCounts[platform];
      }
    });
    return bestPlatform;
  }

  function dominantRating(row) {
    var bestRating = "暂无";
    var bestCount = -1;
    Object.keys(row.ratingCounts || {}).forEach(function (rating) {
      if (row.ratingCounts[rating] > bestCount) {
        bestRating = rating;
        bestCount = row.ratingCounts[rating];
      }
    });
    return bestRating;
  }

  function ensureImportedBubbleMap(container) {
    if (!L) {
      container.innerHTML = '<p class="chart-empty-hint">地图加载失败，请刷新页面重试。</p>';
      return false;
    }
    if (!mapInstance) {
      mapInstance = L.map(CONTAINER_ID, {
        worldCopyJump: true,
        zoomControl: true,
      }).setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap",
      }).addTo(mapInstance);
      mapLayerGroup = L.layerGroup().addTo(mapInstance);
    } else {
      mapLayerGroup.clearLayers();
    }
    return true;
  }

  function updateNewBubbleChart(filters) {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;
    var currentFilters = filters || (typeof global.getFilters === "function" ? global.getFilters() : {});
    var records =
      typeof global.getFilteredRawRecords === "function"
        ? global.getFilteredRawRecords(currentFilters)
        : [];
    var rows = aggregateImportedBubbleRows(records);

    if (!ensureImportedBubbleMap(container)) return;
    if (!rows.length) {
      mapLayerGroup.clearLayers();
      container.classList.add("new-bubble-chart--empty");
      return;
    }
    container.classList.remove("new-bubble-chart--empty");

    var maxCount = rows.reduce(function (max, row) {
      return Math.max(max, row.count);
    }, 1);

    rows.forEach(function (row) {
      var coord = COUNTRY_CENTROIDS[row.country];
      var platform = dominantPlatform(row);
      var commonRating = dominantRating(row);
      var active = !currentFilters.country || currentFilters.country === row.country;
      var radius = 6 + (row.count / maxCount) * 24;
      var circle = L.circleMarker(coord, {
        radius: radius,
        color: active ? "#111827" : "#64748b",
        weight: active ? 1.4 : 0.8,
        fillColor: PLATFORM_COLORS[platform] || "#3b82f6",
        fillOpacity: active ? 0.62 : 0.28,
      });
      circle.bindTooltip(
        '<div class="new-bubble-chart-tooltip">' +
          '<div class="new-bubble-chart-tooltip__title">' +
          escapeHtml(row.country) +
          "</div>" +
          '<div class="new-bubble-chart-tooltip__meta">内容数：' +
          row.count +
          "</div>" +
          '<div class="new-bubble-chart-tooltip__meta">主导平台：' +
          escapeHtml(platform) +
          "</div>" +
          '<div class="new-bubble-chart-tooltip__meta">常见分级：' +
          escapeHtml(commonRating) +
          "</div>" +
          '<div class="new-bubble-chart-tooltip__meta">示例：' +
          escapeHtml(row.sample.title) +
          "</div></div>",
        { sticky: true, direction: "top", opacity: 1, className: "new-bubble-chart-leaflet-tooltip" }
      );
      circle.on("click", function () {
        if (typeof global.updateFilters !== "function") return;
        var latestFilters = typeof global.getFilters === "function" ? global.getFilters() : currentFilters;
        global.updateFilters({
          country: latestFilters.country === row.country ? null : row.country,
          sourceChart: "newBubbleChart",
          sourceView: "newBubbleChart",
          action: "toggleCountry",
        });
      });
      circle.addTo(mapLayerGroup);
    });

    global.setTimeout(function () {
      if (mapInstance) mapInstance.invalidateSize();
    }, 0);
  }

  function initNewBubbleChart() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;
  }

  global.initNewBubbleChart = initNewBubbleChart;
  global.renderNewBubbleChart = updateNewBubbleChart;
  global.updateNewBubbleChart = updateNewBubbleChart;
  global.redrawNewBubbleChart = function () {
    updateNewBubbleChart();
  };
})(typeof window !== "undefined" ? window : globalThis);
