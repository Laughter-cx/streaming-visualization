(function (global) {
  var d3 = global.d3;
  var CONTAINER_ID = "world-map-container";
  var unmatchedCountries = new Set();

  var COUNTRY_COORDS = {
    "United States": [-98.5795, 39.8283],
    Canada: [-106.3468, 56.1304],
    Mexico: [-102.5528, 23.6345],
    Brazil: [-51.9253, -14.235],
    Argentina: [-63.6167, -38.4161],
    Chile: [-71.543, -35.6751],
    Colombia: [-74.2973, 4.5709],
    Peru: [-75.0152, -9.19],
    "United Kingdom": [-3.436, 55.3781],
    France: [2.2137, 46.2276],
    Germany: [10.4515, 51.1657],
    Spain: [-3.7492, 40.4637],
    Italy: [12.5674, 41.8719],
    Netherlands: [5.2913, 52.1326],
    Belgium: [4.4699, 50.5039],
    Sweden: [18.6435, 60.1282],
    Norway: [8.4689, 60.472],
    Denmark: [9.5018, 56.2639],
    Finland: [25.7482, 61.9241],
    Poland: [19.1451, 51.9194],
    Russia: [105.3188, 61.524],
    Turkey: [35.2433, 38.9637],
    Egypt: [30.8025, 26.8206],
    Nigeria: [8.6753, 9.082],
    "South Africa": [22.9375, -30.5595],
    Morocco: [-7.0926, 31.7917],
    Algeria: [1.6596, 28.0339],
    India: [78.9629, 20.5937],
    China: [104.1954, 35.8617],
    Japan: [138.2529, 36.2048],
    "South Korea": [127.7669, 35.9078],
    Indonesia: [113.9213, -0.7893],
    Thailand: [100.9925, 15.87],
    Vietnam: [108.2772, 14.0583],
    Philippines: [121.774, 12.8797],
    Pakistan: [69.3451, 30.3753],
    Bangladesh: [90.3563, 23.685],
    Australia: [133.7751, -25.2744],
    "New Zealand": [174.886, -40.9006],
    "Saudi Arabia": [45.0792, 23.8859],
    "United Arab Emirates": [53.8478, 23.4241],
    Israel: [34.8516, 31.0461],
    Ghana: [-1.0232, 7.9465],
    Ethiopia: [40.4897, 9.145],
    "Czech Republic": [15.473, 49.8175],
    Ireland: [-8.2439, 53.4129],
    Portugal: [-8.2245, 39.3999],
    Austria: [14.5501, 47.5162],
    Switzerland: [8.2275, 46.8182],
    Unknown: null,
  };

  function pickTopRecord(records) {
    if (!records || !records.length) return null;
    return records
      .slice()
      .sort(function (a, b) {
        return (b.rating == null ? -1 : b.rating) - (a.rating == null ? -1 : a.rating);
      })[0];
  }

  function aggregateCountryBubbles(data) {
    var grouped = d3.group(data, function (d) {
      return d.country || "Unknown";
    });
    return Array.from(grouped, function (entry) {
      var country = entry[0];
      if (typeof global.isUnknownCategory === "function" && global.isUnknownCategory(country)) {
        return null;
      }
      var records = entry[1];
      var top = pickTopRecord(records) || {};
      var coord = COUNTRY_COORDS[country] || null;
      if (!coord || coord.length !== 2) {
        if (!unmatchedCountries.has(country)) {
          unmatchedCountries.add(country);
          console.warn("[map] 无法匹配国家坐标:", country);
        }
        return null;
      }
      return {
        country: country,
        count: records.length,
        topTitle: top.title || "未知片名",
        topRating: top.rating == null ? "暂无" : top.rating,
        topDescription: top.description || "暂无简介",
        topPoster: top.poster || "",
        lon: coord[0],
        lat: coord[1],
      };
    }).filter(Boolean);
  }

  function redrawMapChart() {
    console.log("[map] update called");
    if (!d3) return;
    var container = document.getElementById(CONTAINER_ID);
    console.log(
      "[map] container",
      container,
      container ? container.clientWidth : null,
      container ? container.clientHeight : null
    );
    if (!container) return;
    var filters = typeof global.getFilters === "function" ? global.getFilters() : {};
    var data = typeof global.getFilteredData === "function" ? global.getFilteredData(filters) : [];
    console.log("[map] filteredData length", data.length);
    container.innerHTML = "";
    if (!data.length) {
      container.innerHTML = '<p class="chart-empty-hint">当前筛选条件下暂无可展示的地区数据。</p>';
      return;
    }
    var width = Math.max(420, container.clientWidth || 620);
    var height = Math.max(360, container.clientHeight || 420);
    var svg = d3
      .select(container)
      .append("svg")
      .attr("class", "world-map-svg")
      .attr("width", width)
      .attr("height", height);

    var projection = d3.geoNaturalEarth1().fitExtent(
      [
        [16, 16],
        [width - 16, height - 16],
      ],
      { type: "Sphere" }
    );
    var path = d3.geoPath(projection);

    svg
      .append("path")
      .datum({ type: "Sphere" })
      .attr("d", path)
      .attr("fill", "#f8fbff")
      .attr("stroke", "#c8d8ea")
      .attr("stroke-width", 1);

    var graticule = d3.geoGraticule10();
    svg
      .append("path")
      .datum(graticule)
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", "#dce8f3")
      .attr("stroke-width", 0.6);

    var bubbles = aggregateCountryBubbles(data);
    console.log(
      "[map] bubble aggregates top10",
      bubbles
        .slice()
        .sort(function (a, b) {
          return b.count - a.count;
        })
        .slice(0, 10)
    );
    console.log("[map] matched bubble countries", bubbles.length);
    console.log("[map] unmatched countries top20", Array.from(unmatchedCountries).slice(0, 20));
    if (!bubbles.length) {
      container.innerHTML = '<p class="chart-empty-hint">当前筛选条件下暂无可定位的地区内容。</p>';
      return;
    }
    var maxCount = d3.max(bubbles, function (d) {
      return d.count;
    }) || 1;
    var radius = d3.scaleSqrt().domain([1, maxCount]).range([3, 24]);

    svg
      .append("g")
      .attr("class", "world-map-bubbles")
      .selectAll("circle")
      .data(bubbles)
      .join("circle")
      .attr("cx", function (d) {
        return projection([d.lon, d.lat])[0];
      })
      .attr("cy", function (d) {
        return projection([d.lon, d.lat])[1];
      })
      .attr("r", function (d) {
        return radius(d.count);
      })
      .attr("fill", function (d) {
        return filters.country === d.country ? "#f97316" : "#3b82f6";
      })
      .attr("fill-opacity", function (d) {
        return filters.country && filters.country !== d.country ? 0.35 : 0.68;
      })
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1.2)
      .style("cursor", "pointer")
      .on("mouseenter", function (event, d) {
        if (typeof global.showTooltip !== "function") return;
        global.showTooltip(
          {
            subtitle: d.country + " · 影片数 " + d.count,
            title: d.topTitle,
            rating: d.topRating,
            description: d.topDescription,
            poster: d.topPoster,
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
        if (typeof global.hideTooltip === "function") {
          global.hideTooltip();
        }
      })
      .on("click", function (event, d) {
        event.stopPropagation();
        if (typeof global.updateFilters !== "function") return;
        var nextCountry = filters.country === d.country ? null : d.country;
        global.updateFilters({ country: nextCountry, sourceChart: "map" });
      });
  }

  function initMapChart() {
    console.log("[map] init called");
    var container = document.getElementById(CONTAINER_ID);
    console.log(
      "[map] init container",
      container,
      container ? container.clientWidth : null,
      container ? container.clientHeight : null
    );
    if (!container) return;
  }

  function getUnmatchedCountries() {
    return Array.from(unmatchedCountries);
  }

  global.initMapChart = initMapChart;
  global.redrawMapChart = redrawMapChart;
  global.getMapUnmatchedCountries = getUnmatchedCountries;
})(typeof window !== "undefined" ? window : globalThis);
