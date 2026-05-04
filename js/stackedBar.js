/**
 * 堆叠柱状图（D3）。
 * 数据来自 loadStreamingData → getStreamingRecords / getYearFilteredRecords（Phase 5 缓存）。
 * 筛选仅通过 updateFilters 写入；本模块只读 getFilters() 并渲染。
 */

(function (global) {
  var d3 = global.d3;
  var CONTAINER_ID = "stacked-bar-container";

  var STACK_KEYS = ["Movie", "TV Show"];
  var TOP_N_CATEGORIES = 10;
  var CHART_BODY_HEIGHT = 430;

  /** Phase 5：同一年份下仅更新 rect 透明度，不整图 innerHTML 重建 */
  var lastBarLayoutKey = null;

  /**
   * @param {{ year: *, selectedItems: *, dimensions: * }} filters
   */
  function buildStackedRowsFromFilters(filters) {
    if (!d3) return [];
    var records =
      typeof global.getFilteredRawRecords === "function"
        ? global.getFilteredRawRecords(filters)
        : typeof global.getStreamingRecords === "function"
          ? global.getStreamingRecords()
          : null;
    if (!records || !records.length) return [];
    var filtered = records;
    if (!filtered.length) return [];

    var grouped = d3.group(filtered, function (d) {
      var c = d.country && String(d.country).trim() ? String(d.country).trim() : "Unknown";
      return c;
    });

    var rows = Array.from(grouped, function (entry) {
      var cat = entry[0];
      var v = entry[1];
      var movie = 0;
      var tv = 0;
      v.forEach(function (d) {
        if (d.type === "Movie") movie += 1;
        else if (d.type === "TV Show") tv += 1;
      });
      return {
        category: cat,
        Movie: movie,
        "TV Show": tv,
        _total: movie + tv,
      };
    });

    var unknownRow = null;
    var knownRows = rows.filter(function (r) {
      var isUnknown =
        (typeof global.isUnknownCategory === "function" && global.isUnknownCategory(r.category)) ||
        r.category === "Unknown";
      if (isUnknown) {
        unknownRow = r;
        return false;
      }
      return true;
    });

    knownRows.sort(function (a, b) {
      return b._total - a._total;
    });
    var topKnown = knownRows.slice(0, TOP_N_CATEGORIES);
    var restKnown = knownRows.slice(TOP_N_CATEGORIES);
    if (restKnown.length > 0) {
      var others = restKnown.reduce(
        function (acc, r) {
          acc.Movie += r.Movie;
          acc["TV Show"] += r["TV Show"];
          acc._total += r._total;
          return acc;
        },
        { category: "Others", Movie: 0, "TV Show": 0, _total: 0 }
      );
      topKnown.push(others);
    }
    // 展示层隐藏 Unknown：数据层仍保留。
    topKnown.forEach(function (r) {
      delete r._total;
    });
    return topKnown;
  }

  function toggleSelectedBar(list, category, seriesKey) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].category === category && list[i].series === seriesKey) {
        var copy = list.slice();
        copy.splice(i, 1);
        return copy;
      }
    }
    var next = list.slice();
    next.push({ category: category, series: seriesKey });
    return next;
  }

  /**
   * @param {Set<string>|null|undefined} activeRegions
   */
  function segmentOpacity(cat, seriesKey, filters, activeRegions) {
    if (activeRegions) {
      if (activeRegions.size === 0 || !activeRegions.has(cat)) {
        return 0.16;
      }
    }
    var sels = filters.selectedItems || [];
    if (sels.length === 0) return 1;
    var hit = sels.some(function (sb) {
      return sb.category === cat && sb.series === seriesKey;
    });
    return hit ? 1 : 0.3;
  }

  var SERIES_LABEL = { Movie: "电影", "TV Show": "剧集" };

  function barLayoutKey(filters) {
    return JSON.stringify({
      platforms: filters.platforms || [],
      genre: filters.genre || "All",
      contentRatings: filters.contentRatings || [],
      ratingRange: filters.ratingRange || null,
      country: filters.country || null,
      selectedPlatform: filters.selectedPlatform || null,
      year: filters.year == null || typeof filters.year !== "number" || isNaN(filters.year)
        ? null
        : filters.year,
    });
  }

  /**
   * 仅更新堆叠条透明度（D3 增量：不改轴、不销毁 SVG）。
   */
  function updateStackedBarOpacities(containerEl, filters, activeRegions) {
    d3.select(containerEl)
      .selectAll(".stacked-layer")
      .each(function () {
        var serie = d3.select(this).datum();
        var key = serie.key;
        d3.select(this)
          .selectAll("rect")
          .attr("opacity", function (d) {
            return segmentOpacity(d.data.category, key, filters, activeRegions);
          });
      });
  }

  /**
   * 全量创建（仅年份或首帧或容器无根节点时）
   */
  function renderStackedBarFull(data, filters, activeRegions, containerEl) {
    if (!d3 || !containerEl) return;
    var margin = { top: 16, right: 16, bottom: 84, left: 56 };
    var width = Math.max(320, containerEl.clientWidth || 520) - margin.left - margin.right;
    var innerH = CHART_BODY_HEIGHT - 32;
    var height = innerH - margin.top - margin.bottom;

    containerEl.innerHTML = "";

    if (!data.length) {
      d3.select(containerEl).append("p").attr("class", "chart-empty-hint").text("当前筛选条件下暂无可展示的地区数据。");
      return;
    }

    var wrap = d3
      .select(containerEl)
      .append("div")
      .attr("class", "stacked-bar-root");

    var tooltip = wrap.append("div").attr("class", "stacked-bar-tooltip").style("opacity", 0);

    var svg = wrap
      .append("svg")
      .attr("class", "stacked-bar-svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom);

    var g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    var stackGen = d3.stack().keys(STACK_KEYS);
    var series = stackGen(data);

    var x = d3
      .scaleBand()
      .domain(
        data.map(function (d) {
          return d.category;
        })
      )
      .range([0, width])
      .padding(0.25);

    var yMax = d3.max(series, function (s) {
      return d3.max(s, function (d) {
        return d[1];
      });
    });
    var y = d3
      .scaleLinear()
      .domain([0, yMax || 1])
      .nice()
      .range([height, 0]);

    var color = d3.scaleOrdinal().domain(STACK_KEYS).range(["#4e79a7", "#59a14f"]);

    g.append("g")
      .attr("class", "stacked-bar-axis stacked-bar-axis--x")
      .attr("transform", "translate(0," + height + ")")
      .call(d3.axisBottom(x))
      .selectAll("text")
      .attr("transform", "rotate(-38)")
      .style("text-anchor", "end");

    g.append("g").attr("class", "stacked-bar-axis stacked-bar-axis--y").call(d3.axisLeft(y).ticks(5));
    g.append("text")
      .attr("class", "stacked-bar-axis-title")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", -42)
      .attr("text-anchor", "middle")
      .text("内容数量");

    var layer = g
      .selectAll(".stacked-layer")
      .data(series)
      .join("g")
      .attr("class", "stacked-layer")
      .attr("fill", function (d) {
        return color(d.key);
      });

    layer
      .selectAll("rect")
      .data(function (d) {
        return d;
      })
      .join("rect")
      .attr("x", function (d) {
        return x(d.data.category);
      })
      .attr("y", function (d) {
        return y(d[1]);
      })
      .attr("height", function (d) {
        return y(d[0]) - y(d[1]);
      })
      .attr("width", x.bandwidth())
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .attr("opacity", function (d) {
        var cat = d.data.category;
        var key = d3.select(this.parentNode).datum().key;
        return segmentOpacity(cat, key, filters, activeRegions);
      })
      .style("cursor", "pointer")
      .on("mouseenter", function (event, d) {
        var serie = d3.select(this.parentNode).datum();
        var key = serie.key;
        var val = d.data[key];
        var label = SERIES_LABEL[key] || key;
        var total = (d.data.Movie || 0) + (d.data["TV Show"] || 0);
        tooltip
          .html(
            "<strong>" +
              d.data.category +
              "</strong><br/>" +
              "电影: " +
              (d.data.Movie || 0) +
              "<br/>剧集: " +
              (d.data["TV Show"] || 0) +
              "<br/>总数: " +
              total +
              "<br/>当前段(" +
              label +
              "): " +
              val
          )
          .style("left", event.pageX + 12 + "px")
          .style("top", event.pageY - 28 + "px")
          .style("opacity", 1);
      })
      .on("mousemove", function (event) {
        tooltip.style("left", event.pageX + 12 + "px").style("top", event.pageY - 28 + "px");
      })
      .on("mouseleave", function () {
        tooltip.style("opacity", 0);
      })
      .on("click", function (event, d) {
        event.stopPropagation();
        var serie = d3.select(this.parentNode).datum();
        var category = d.data.category;
        var seriesKey = serie.key;
        if (typeof global.getFilters !== "function" || typeof global.updateFilters !== "function") return;
        var cur = global.getFilters().selectedItems || [];
        var next = toggleSelectedBar(cur, category, seriesKey);
        global.updateFilters({
          selectedItems: next,
          sourceView: "stackedBar",
          action: "toggleBar",
        });
      });

    var legend = wrap.append("div").attr("class", "stacked-bar-legend");
    STACK_KEYS.forEach(function (key) {
      var row = legend.append("div").attr("class", "stacked-bar-legend__item");
      row.append("span").attr("class", "stacked-bar-legend__swatch").style("background", color(key));
      row.append("span").text(SERIES_LABEL[key] || key);
    });
    var hasUnknown = data.some(function (d) {
      return d.category === "Unknown";
    });
    if (hasUnknown) {
      wrap
        .append("div")
        .attr("class", "stacked-bar-note")
        .text("部分作品缺少地区信息，已在统计中单独处理。");
    }
  }

  function redrawStackedBar() {
    var filters = typeof global.getFilters === "function" ? global.getFilters() : {};
    var el = document.getElementById(CONTAINER_ID);
    if (!el) return;

    var k = barLayoutKey(filters);
    var data = buildStackedRowsFromFilters(filters);
    var pr =
      typeof global.buildParallelRowsForCharts === "function" ? global.buildParallelRowsForCharts() : [];
    var activeRegions = null;
    if (typeof global.computeActiveRegionSet === "function") {
      activeRegions = global.computeActiveRegionSet(pr, filters);
    }

    if (!data.length) {
      lastBarLayoutKey = k;
      el.innerHTML = '<p class="chart-empty-hint">当前筛选条件下暂无可展示的地区数据。</p>';
      return;
    }

    var hasRoot = d3 && el.querySelector && el.querySelector(".stacked-bar-root");
    if (hasRoot && k === lastBarLayoutKey) {
      updateStackedBarOpacities(el, filters, activeRegions);
      return;
    }

    lastBarLayoutKey = k;
    renderStackedBarFull(data, filters, activeRegions, el);
  }

  function initStackedBar() {
    if (!document.getElementById(CONTAINER_ID)) return;
  }

  global.renderStackedBar = redrawStackedBar;
  global.buildStackedRowsFromFilters = buildStackedRowsFromFilters;
  global.initStackedBar = initStackedBar;
  global.redrawStackedBar = redrawStackedBar;
})(typeof window !== "undefined" ? window : globalThis);
