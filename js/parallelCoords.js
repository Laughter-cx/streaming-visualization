/**
 * 平行坐标图（D3）+ 单轴 brush（可扩展多轴）。
 * 数据来自 getStreamingRecords / getYearFilteredRecords（Phase 5：年切片缓存、同布局下仅更新 path 透明度）。
 * 筛选经 mergeDimensionRange / updateFilters 写入全局 dimensions；本模块只读 getFilters() 并渲染。
 */

(function (global) {
  var d3 = global.d3;
  var CONTAINER_ID = "parallel-coords-container";

  /** 派生行缓存，避免同一年份重复 map+抽样 */
  var pcRowsCacheKey = null;
  var pcRowsCache = null;

  /** 与年份+年切片行数一致时跳过整图重绘，仅作 opacity 增量 */
  var lastParallelLayoutKey = null;

  /** 与 JSON 及 getFilters().dimensions 的 key 一致 */
  var PARALLEL_DIMENSIONS = [
    { key: "rating", label: "内容分级", type: "category" },
    { key: "duration", label: "时长(分钟)", type: "value" },
    { key: "yearBand", label: "上映年份区间", type: "category" },
    { key: "genre", label: "类型", type: "category" },
  ];

  var BRUSH_AXIS_KEYS = [];

  var suppressBrushEnd = false;

  /** 平行坐标显示行数上限，避免全量路径卡死浏览器 */
  var MAX_PC_LINES = 300;
  var CHART_BODY_HEIGHT = 430;

  var MAX_RELEASE_YEAR = 2021;
  var MIN_RELEASE_YEAR = 2000;
  var YEAR_BAND_SIZE = 5;

  var CONTENT_RATING_ORDER = [
    "TV-Y",
    "TV-Y7",
    "TV-G",
    "G",
    "TV-PG",
    "PG",
    "PG-13",
    "TV-14",
    "R",
    "TV-MA",
  ];

  function isKnownValue(value) {
    if (typeof global.isUnknownCategory === "function") {
      return !global.isUnknownCategory(value);
    }
    return value != null && String(value).trim().toLowerCase() !== "unknown";
  }

  function parseNumberLike(value) {
    if (typeof value === "number" && isFinite(value)) return value;
    if (value == null) return NaN;
    var text = String(value).trim();
    if (!text) return NaN;
    var n = Number(text);
    return isFinite(n) ? n : NaN;
  }

  function normalizeRating(record) {
    var raw =
      record.rating != null
        ? record.rating
        : record.score != null
          ? record.score
          : record.imdb_score != null
            ? record.imdb_score
            : record.vote_average;
    if (!isKnownValue(raw)) return null;
    return String(raw).trim();
  }

  function parseDuration(record) {
    var direct = parseNumberLike(
      record.duration_minutes != null
        ? record.duration_minutes
        : record.runtime != null
          ? record.runtime
          : record.minutes
    );
    if (isFinite(direct) && direct > 0) return direct;
    var raw = record.duration;
    if (raw == null) return NaN;
    var text = String(raw).toLowerCase();
    if (text.indexOf("min") === -1) return NaN;
    var match = text.match(/\d+/);
    return match ? Number(match[0]) : NaN;
  }

  function parseYear(record) {
    return parseNumberLike(record.release_year);
  }

  function buildYearBands() {
    var out = [];
    var hi = MAX_RELEASE_YEAR;
    while (hi > MIN_RELEASE_YEAR) {
      var lo = Math.max(MIN_RELEASE_YEAR, hi - YEAR_BAND_SIZE);
      out.push(hi + "-" + lo);
      hi = lo;
    }
    return out;
  }

  function yearBandFor(year) {
    var bands = buildYearBands();
    var hi = MAX_RELEASE_YEAR;
    var i;
    for (i = 0; i < bands.length; i++) {
      var lo = Math.max(MIN_RELEASE_YEAR, hi - YEAR_BAND_SIZE);
      if (year <= hi && year > lo) return bands[i];
      if (lo === MIN_RELEASE_YEAR && year <= hi && year >= lo) return bands[i];
      hi = lo;
    }
    return null;
  }

  function normalizeGenre(record) {
    var raw = record.genre || record.genres || record.listed_in || record.type;
    if (Array.isArray(raw)) raw = raw.join(",");
    if (raw == null) return null;
    var first = String(raw)
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(isKnownValue)[0];
    return first || null;
  }

  function buildParallelData(rows) {
    return (rows || [])
      .map(function (record, index) {
        var rating = normalizeRating(record);
        var duration = parseDuration(record);
        var year = parseYear(record);
        var genre = normalizeGenre(record);
        return {
          id: "pc-" + index + "-" + (record.title || ""),
          title: record.title || "未知片名",
          platform: record.platform || "未知平台",
          country: record.country && String(record.country).trim() ? String(record.country) : "Unknown",
          rating: rating,
          duration: duration,
          year: year,
          yearBand: yearBandFor(year),
          release_year: year,
          genre: genre,
        };
      })
      .filter(function (row) {
        return (
          isKnownValue(row.rating) &&
          isFinite(row.duration) &&
          isFinite(row.year) &&
          row.year <= MAX_RELEASE_YEAR &&
          row.year >= MIN_RELEASE_YEAR &&
          isKnownValue(row.yearBand) &&
          isKnownValue(row.genre)
        );
      });
  }

  /**
   * 从原始记录派生平行坐标行（与 computeActiveRegionSet / 柱图 country 对齐）。
   * @param {Array<Record<string, unknown>>} records
   * @param {{ year: *, selectedItems: *, dimensions: * }} filters
   */
  function buildParallelRowsFromRecords(records, filters) {
    if (!records || !records.length) return [];
    var effectiveFilters = Object.assign({}, filters, {
      year: null,
    });
    var filtered =
      typeof global.getFilteredRawRecords === "function"
        ? global.getFilteredRawRecords(effectiveFilters)
        : records;
    if (!filtered.length) {
      return [];
    }
    var k = JSON.stringify({
      n: filtered.length,
      platforms: filters.platforms || [],
      genre: filters.genre || "All",
      contentRatings: filters.contentRatings || [],
      ratingRange: filters.ratingRange || null,
      country: filters.country || null,
      selectedPlatform: filters.selectedPlatform || null,
      year: null,
    });
    if (k === pcRowsCacheKey && pcRowsCache) {
      return pcRowsCache;
    }

    var rows = buildParallelData(filtered);

    if (rows.length > MAX_PC_LINES) {
      var step = rows.length / MAX_PC_LINES;
      var sampled = [];
      var j;
      for (j = 0; j < MAX_PC_LINES; j++) {
        sampled.push(rows[Math.floor(j * step)]);
      }
      rows = sampled;
    }
    pcRowsCacheKey = k;
    pcRowsCache = rows;
    return rows;
  }

  /**
   * 供柱图 segmentOpacity 与 filters.computeActiveRegionSet 使用，与当前图数据一致。
   */
  function buildParallelRowsForCharts() {
    var records =
      typeof global.getStreamingRecords === "function" ? global.getStreamingRecords() : null;
    if (!records || !records.length) return [];
    var filters = typeof global.getFilters === "function" ? global.getFilters() : {};
    return buildParallelRowsFromRecords(records, filters);
  }

  function rowPassesAxisBrushes(row, brushMap, dimKeys) {
    var k;
    var range;
    var v;
    for (k in brushMap) {
      if (!Object.prototype.hasOwnProperty.call(brushMap, k)) continue;
      range = brushMap[k];
      if (!range || !Array.isArray(range)) continue;
      if (dimKeys.indexOf(k) === -1) continue;
      if (k === "rating" || k === "genre") continue;
      v = row[k];
      if (typeof v !== "number" || isNaN(v)) return false;
      if (v < range[0] || v > range[1]) return false;
    }
    return true;
  }

  function parallelLayoutKey(filters) {
    var effectiveYear = null;
    var n = typeof global.getFilteredRawRecords === "function"
      ? global.getFilteredRawRecords(Object.assign({}, filters, { year: effectiveYear })).length
      : typeof global.getStreamingRecords === "function" && global.getStreamingRecords()
        ? global.getStreamingRecords().length
        : 0;
    return JSON.stringify({
      n: n,
      platforms: filters.platforms || [],
      genre: filters.genre || "All",
      contentRatings: filters.contentRatings || [],
      ratingRange: filters.ratingRange || null,
      country: filters.country || null,
      selectedPlatform: filters.selectedPlatform || null,
      selectedItems: filters.selectedItems || [],
      dimensions: filters.dimensions || {},
      year: null,
    });
  }

  function lineOpacity(row, filters, inBrush) {
    var base = inBrush ? 0.85 : 0.12;
    var sels = filters.selectedItems || [];
    if (sels.length > 0) {
      var match = sels.some(function (sb) {
        return sb.category === row.country;
      });
      if (!match) base *= 0.22;
    }
    return Math.min(1, Math.max(0.05, base));
  }

  /**
   * @param {Array<Record<string, unknown>>} data
   * @param {{ year: *, selectedItems: *, dimensions: * }} filters
   * @param {HTMLElement} containerEl
   */
  function renderParallelCoords(data, filters, containerEl) {
    if (!d3 || !containerEl) return;

    var dimensions = PARALLEL_DIMENSIONS.map(function (d) {
      return d.key;
    });
    var brushMap =
      filters.dimensions && typeof filters.dimensions === "object"
        ? /** @type {Record<string, [number, number]>} */ (filters.dimensions)
        : {};

    var margin = { top: 40, right: 24, bottom: 28, left: 36 };
    var width = Math.max(360, containerEl.clientWidth || 620) - margin.left - margin.right;
    var innerH = CHART_BODY_HEIGHT - 24;
    var height = innerH - margin.top - margin.bottom;

    containerEl.innerHTML = "";

    if (!data.length) {
      d3.select(containerEl).append("p").attr("class", "chart-empty-hint").text("当前筛选条件下暂无可对比的作品。");
      return;
    }

    var svg = d3
      .select(containerEl)
      .append("svg")
      .attr("class", "parallel-coords-svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom);

    var gRoot = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    var x = d3.scalePoint().domain(dimensions).range([0, width]).padding(0.55);

    var y = {};
    PARALLEL_DIMENSIONS.forEach(function (dim) {
      if (dim.type === "category") {
        var categoriesRaw = Array.from(
          new Set(
            data.map(function (d) {
              return d[dim.key];
            })
          )
        );
        var categories =
          dim.key === "rating"
            ? CONTENT_RATING_ORDER.filter(function (rating) {
                return categoriesRaw.indexOf(rating) !== -1;
              }).concat(
                categoriesRaw
                  .filter(function (rating) {
                    return CONTENT_RATING_ORDER.indexOf(rating) === -1;
                  })
                  .sort()
              )
            : dim.key === "yearBand"
              ? buildYearBands().filter(function (band) {
                  return categoriesRaw.indexOf(band) !== -1;
                })
            : categoriesRaw.sort();
        y[dim.key] = d3.scalePoint().domain(categories).range([height, 0]).padding(0.35);
        return;
      }
      var extent = d3.extent(data, function (d) {
        return d[dim.key];
      });
      var lo = extent[0] == null ? 0 : extent[0];
      var hi = extent[1] == null ? 1 : extent[1];
      if (dim.key === "year") {
        lo = MIN_RELEASE_YEAR;
        hi = MAX_RELEASE_YEAR;
      }
      if (lo === hi) {
        hi = lo + 1;
      }
      y[dim.key] = d3.scaleLinear().domain([lo, hi]).range([height, 0]);
    });

    var lineGen = d3
      .line()
      .x(function (d) {
        return d[0];
      })
      .y(function (d) {
        return d[1];
      })
      .defined(function (d) {
        return d && !isNaN(d[0]) && !isNaN(d[1]);
      });

    function pathForRow(d) {
      return lineGen(
        dimensions.map(function (key) {
          return [x(key), y[key](d[key])];
        })
      );
    }

    var inBrushFn = function (d) {
      return rowPassesAxisBrushes(d, brushMap, dimensions);
    };

    gRoot
      .append("g")
      .attr("class", "parallel-coords-lines")
      .selectAll("path")
      .data(data)
      .join("path")
      .attr("class", "parallel-coords-line")
      .attr("d", pathForRow)
      .attr("fill", "none")
      .attr("stroke", "#3b6ea5")
      .attr("stroke-width", 1.2)
      .attr("opacity", function (d) {
        return lineOpacity(d, filters, inBrushFn(d));
      })
      .style("pointer-events", "stroke")
      .on("mouseenter", function (event, d) {
        if (typeof global.showTooltip !== "function") return;
        global.showTooltip(
          {
            subtitle: d.platform,
            title: d.title,
            rating: d.rating,
            ratingLabel: "内容分级",
            description:
              "时长 " +
              d.duration +
              " 分钟 · 年份 " +
              d.year +
              " · 上映年份区间 " +
              d.yearBand +
              " · 类型 " +
              d.genre,
            metrics: [
              { label: "内容分级", value: d.rating },
              { label: "时长", value: d.duration + " 分钟" },
              { label: "年份", value: d.year },
              { label: "上映年份区间", value: d.yearBand },
              { label: "类型", value: d.genre },
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
        if (typeof global.hideTooltip === "function") {
          global.hideTooltip();
        }
      })
      .on("click", function (event, d) {
        event.stopPropagation();
        if (typeof global.updateFilters !== "function") return;
        var latest = typeof global.getFilters === "function" ? global.getFilters() : filters;
        global.updateFilters({
          genre: latest.genre === d.genre ? "All" : d.genre,
          sourceView: "parallelCoords",
          action: "toggleGenre",
        });
      });

    var axisG = gRoot
      .append("g")
      .attr("class", "parallel-coords-axes")
      .selectAll("g")
      .data(PARALLEL_DIMENSIONS)
      .join("g")
      .attr("class", "parallel-coords-axis")
      .attr("transform", function (d) {
        return "translate(" + x(d.key) + ",0)";
      });

    axisG
      .each(function (d) {
        var axis = d.type === "category"
          ? d3.axisLeft(y[d.key]).tickSizeOuter(0)
          : d.key === "year"
            ? d3
                .axisLeft(y[d.key])
                .tickValues(d3.range(y[d.key].domain()[0], y[d.key].domain()[1] + 1, 1))
                .tickFormat(d3.format("d"))
                .tickSizeOuter(0)
            : d3.axisLeft(y[d.key]).ticks(4).tickSizeOuter(0);
        d3.select(this).call(axis);
      })
      .append("text")
      .attr("class", "parallel-coords-axis-title")
      .attr("text-anchor", "middle")
      .attr("y", -12)
      .attr("fill", "#222")
      .text(function (d) {
        return d.label;
      });

    var brushDim = BRUSH_AXIS_KEYS[0];
    if (brushDim && dimensions.indexOf(brushDim) !== -1) {
      var bw = 18;
      // Phase 4：只监听 brush 的 "end"（等同 brushend），不在 "brush" 上写全局 state，避免拖动时高频 updateFilters/全图重绘
      var brush = d3
        .brushY()
        .extent([
          [-bw / 2, 0],
          [bw / 2, height],
        ])
        .on("end", function (event) {
          if (suppressBrushEnd) return;
          if (typeof global.mergeDimensionRange !== "function") return;
          if (!event.selection) {
            global.mergeDimensionRange(brushDim, null);
            return;
          }
          var sel = event.selection;
          var y0 = sel[0];
          var y1 = sel[1];
          var ys = y[brushDim];
          var v0 = ys.invert(y0);
          var v1 = ys.invert(y1);
          var lo = Math.min(v0, v1);
          var hi = Math.max(v0, v1);
          global.mergeDimensionRange(brushDim, [lo, hi]);
        });

      var brushHost = axisG
        .filter(function (d) {
          return d.key === brushDim;
        })
        .append("g")
        .attr("class", "parallel-coords-brush");

      brushHost.call(brush);

      var saved = brushMap[brushDim];
      if (saved && Array.isArray(saved) && saved.length === 2) {
        var p0 = y[brushDim](saved[0]);
        var p1 = y[brushDim](saved[1]);
        suppressBrushEnd = true;
        brush.move(brushHost, [Math.min(p0, p1), Math.max(p0, p1)]);
        global.setTimeout(function () {
          suppressBrushEnd = false;
        }, 0);
      }
    }
  }

  /**
   * 仅更新线透明度（不改 path d、不销毁 brush），用于 dimensions/selectedItems 变化且年份与底层切片未变时。
   */
  function updateParallelOpacitiesOnly(containerEl, data, filters) {
    var dimKeys = PARALLEL_DIMENSIONS.map(function (d) {
      return d.key;
    });
    var brushMap =
      filters.dimensions && typeof filters.dimensions === "object"
        ? /** @type {Record<string, [number, number]>} */ (filters.dimensions)
        : {};
    var inBrushFn = function (d) {
      return rowPassesAxisBrushes(d, brushMap, dimKeys);
    };
    d3.select(containerEl)
      .selectAll(".parallel-coords-line")
      .data(data)
      .attr("opacity", function (d) {
        return lineOpacity(d, filters, inBrushFn(d));
      });
  }

  function redrawParallelCoords() {
    var filters = typeof global.getFilters === "function" ? global.getFilters() : {};
    var records =
      typeof global.getStreamingRecords === "function" ? global.getStreamingRecords() : null;
    var el = document.getElementById(CONTAINER_ID);
    if (!el) return;
    if (!records || !records.length) {
      el.innerHTML = '<p class="chart-empty-hint">数据正在加载，请稍候。</p>';
      lastParallelLayoutKey = null;
      return;
    }
    var k = parallelLayoutKey(filters);
    var data = buildParallelRowsFromRecords(records, filters);
    if (!data.length) {
      el.innerHTML = '<p class="chart-empty-hint">当前筛选条件下暂无可对比的作品。</p>';
      lastParallelLayoutKey = k;
      return;
    }
    if (el.querySelector("svg.parallel-coords-svg") && k === lastParallelLayoutKey) {
      updateParallelOpacitiesOnly(el, data, filters);
      return;
    }
    lastParallelLayoutKey = k;
    renderParallelCoords(data, filters, el);
  }

  function initParallelCoords() {
    if (!document.getElementById(CONTAINER_ID)) return;
  }

  global.renderParallelCoords = renderParallelCoords;
  global.buildParallelRowsForCharts = buildParallelRowsForCharts;
  global.initParallelCoords = initParallelCoords;
  global.redrawParallelCoords = redrawParallelCoords;
})(typeof window !== "undefined" ? window : globalThis);
