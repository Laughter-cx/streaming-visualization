/**
 * 全局唯一 filter state 与统一入口 updateFilters(filters)。
 * 所有行级/区间/选中规则均在此或由此导出的纯函数实现；组件不得维护平行副本。
 *
 * 扁平形态（getFilters 快照）例如：
 * {
 *   year: number|null,
 *   contentRatings: string[],
 *   selectedItems: Array<{ category: string, series: string }>,
 *   dimensions: Record<string, [number, number]>,  // 各轴 brush 区间
 *   brushedRange: null,  // 保留字段，与多轴时以 dimensions 为准
 *   sourceView: string,
 *   action: string
 * }
 */

(function (global) {
  /**
   * @type {{
   *   year: number|null,
   *   contentRatings: string[],
   *   selectedItems: Array<{ category: string, series: string }>,
   *   dimensions: Record<string, [number, number]>,
   *   brushedRange: [number, number]|null,
   *   sourceView: string,
   *   action: string
   * }}
   */
  var filterState = {
    platforms: [],
    genre: "All",
    ratingRange: [0, 10],
    contentRatings: [],
    country: null,
    selectedPlatform: null,
    selectedTitle: null,
    sourceChart: null,
    year: null,
    selectedItems: [],
    dimensions: {},
    brushedRange: null,
    sourceView: "",
    action: "",
  };

  /** @type {Array<() => void>} */
  var filterListeners = [];
  var updateAllChartsHandler = null;
  var isUpdatingFilters = false;

  function normalizeSelectedItems(input) {
    if (!Array.isArray(input)) return [];
    return input
      .map(function (it) {
        if (!it || typeof it !== "object") return null;
        return { category: String(it.category), series: String(it.series) };
      })
      .filter(Boolean);
  }

  function copyDimensions(d) {
    if (!d || typeof d !== "object") return {};
    var out = {};
    var k;
    for (k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      out[k] = d[k];
    }
    return out;
  }

  function normalizeStringList(input) {
    if (!Array.isArray(input)) return [];
    return input
      .map(function (v) {
        if (v == null) return "";
        return String(v).trim();
      })
      .filter(function (v) {
        return v.length > 0;
      });
  }

  function normalizeRatingRange(input) {
    if (!Array.isArray(input) || input.length < 2) return [0, 10];
    var minV = Number(input[0]);
    var maxV = Number(input[1]);
    if (isNaN(minV)) minV = 0;
    if (isNaN(maxV)) maxV = 10;
    if (minV > maxV) {
      var t = minV;
      minV = maxV;
      maxV = t;
    }
    return [minV, maxV];
  }

  /**
   * 行是否落在所有已选维度的数值区间内（key 与数据列、dimensions 的 key 一致）。
   * @param {Record<string, unknown>} row
   * @param {Record<string, [number, number]>} dimensions
   */
  function rowMatchesDimensions(row, dimensions) {
    if (!dimensions || typeof dimensions !== "object") return true;
    var k;
    var range;
    var v;
    for (k in dimensions) {
      if (!Object.prototype.hasOwnProperty.call(dimensions, k)) continue;
      range = dimensions[k];
      if (!range || !Array.isArray(range) || range.length < 2) continue;
      v = row[k];
      if (typeof v !== "number" || isNaN(v)) return false;
      if (v < range[0] || v > range[1]) return false;
    }
    return true;
  }

  /**
   * 根据 dimensions brush + 年份，从平行坐标行归纳「仍可见」的国家集合（与柱图 category=country 对齐）。
   * @param {Array<Record<string, unknown>>} parallelRows
   * @param {*} filters
   * @returns {Set<string>|null}
   */
  function computeActiveRegionSet(parallelRows, filters) {
    var br = (filters && filters.dimensions) || {};
    if (Object.keys(br).length === 0) return null;
    var out = new Set();
    parallelRows.forEach(function (r) {
      if (!rowMatchesDimensions(r, br)) return;
      if (filters.year != null && typeof filters.year === "number" && r.release_year !== filters.year) {
        return;
      }
      if (r.country) out.add(String(r.country));
    });
    return out;
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return;
    filterListeners.push(fn);
  }

  function notifyFilterListeners() {
    filterListeners.forEach(function (listener) {
      try {
        listener();
      } catch (e) {
        console.error(e);
      }
    });
  }

  /**
   * Phase 5：仅当影响可视筛选的字段变化时视为不同，避免同值 updateFilters 触发全图重绘。
   * @param {*} a
   * @param {*} b
   */
  function filterMeaningfulEqual(a, b) {
    if (JSON.stringify(a.platforms) !== JSON.stringify(b.platforms)) return false;
    if (a.genre !== b.genre) return false;
    if (JSON.stringify(a.contentRatings) !== JSON.stringify(b.contentRatings)) return false;
    if (a.country !== b.country) return false;
    if (a.selectedPlatform !== b.selectedPlatform) return false;
    if (a.selectedTitle !== b.selectedTitle) return false;
    if (a.sourceChart !== b.sourceChart) return false;
    if (
      !a.ratingRange ||
      !b.ratingRange ||
      a.ratingRange[0] !== b.ratingRange[0] ||
      a.ratingRange[1] !== b.ratingRange[1]
    ) {
      return false;
    }
    if (a.year !== b.year) return false;
    if (JSON.stringify(a.selectedItems) !== JSON.stringify(b.selectedItems)) return false;
    if (JSON.stringify(a.dimensions) !== JSON.stringify(b.dimensions)) return false;
    if (a.brushedRange == null && b.brushedRange == null) return true;
    if (a.brushedRange == null || b.brushedRange == null) return false;
    return (
      a.brushedRange[0] === b.brushedRange[0] && a.brushedRange[1] === b.brushedRange[1]
    );
  }

  /**
   * 在单一维度上合并/清除 brush 区间，并写回 sourceView / action。全部逻辑在 filters 内，组件只调此入口。
   * @param {string} dimensionKey
   * @param {[number, number]|null|undefined} dataRange
   */
  function mergeDimensionRange(dimensionKey, dataRange) {
    if (typeof dimensionKey !== "string" || !dimensionKey) return getFilters();
    var prev = copyDimensions(filterState.dimensions);
    var next = Object.assign({}, prev);
    if (!dataRange) {
      delete next[dimensionKey];
    } else {
      next[dimensionKey] = [dataRange[0], dataRange[1]];
    }
    return updateFilters({
      dimensions: next,
      sourceView: "parallelCoords",
      action: "brush",
    });
  }

  /**
   * 统一入口：按传入键合并到全局 state（dimensions / selectedItems 在传入键存在时为整块替换，与原先 brushedRanges 语义一致）。
   * @param {Partial<{
   *   year: number|null,
   *   contentRatings: unknown,
   *   selectedItems: unknown,
   *   dimensions: unknown,
   *   brushedRange: [number, number]|null,
   *   sourceView: string,
   *   action: string
   * }>} patch
   */
  function updateFilters(patch) {
    if (!patch || typeof patch !== "object") {
      return getFilters();
    }
    if (isUpdatingFilters) {
      return getFilters();
    }
    isUpdatingFilters = true;
    var before = getFilters();
    if ("platforms" in patch) {
      filterState.platforms = normalizeStringList(patch.platforms);
    }
    if ("genre" in patch) {
      filterState.genre =
        patch.genre == null || String(patch.genre).trim() === ""
          ? "All"
          : String(patch.genre);
    }
    if ("ratingRange" in patch) {
      filterState.ratingRange = normalizeRatingRange(patch.ratingRange);
    }
    if ("contentRatings" in patch) {
      filterState.contentRatings = normalizeStringList(patch.contentRatings);
    }
    if ("country" in patch) {
      filterState.country = patch.country == null ? null : String(patch.country);
    }
    if ("selectedPlatform" in patch) {
      filterState.selectedPlatform =
        patch.selectedPlatform == null ? null : String(patch.selectedPlatform);
    }
    if ("selectedTitle" in patch) {
      filterState.selectedTitle = patch.selectedTitle == null ? null : String(patch.selectedTitle);
    }
    if ("sourceChart" in patch) {
      filterState.sourceChart = patch.sourceChart == null ? null : String(patch.sourceChart);
    }
    if ("year" in patch) {
      filterState.year = patch.year;
    }
    if ("selectedItems" in patch) {
      filterState.selectedItems = normalizeSelectedItems(patch.selectedItems);
    }
    if ("dimensions" in patch) {
      filterState.dimensions =
        patch.dimensions && typeof patch.dimensions === "object"
          ? copyDimensions(patch.dimensions)
          : {};
    }
    if ("brushedRange" in patch) {
      filterState.brushedRange = patch.brushedRange;
    }
    if ("sourceView" in patch) {
      filterState.sourceView = patch.sourceView != null ? String(patch.sourceView) : "";
    }
    if ("action" in patch) {
      filterState.action = patch.action != null ? String(patch.action) : "";
    }
    if (filterMeaningfulEqual(before, getFilters())) {
      isUpdatingFilters = false;
      return getFilters();
    }
    if (typeof updateAllChartsHandler === "function") {
      try {
        updateAllChartsHandler();
      } catch (err) {
        console.error(err);
      }
    }
    notifyFilterListeners();
    isUpdatingFilters = false;
    return getFilters();
  }

  function getFilters() {
    return {
      platforms: filterState.platforms.slice(),
      genre: filterState.genre,
      ratingRange: [filterState.ratingRange[0], filterState.ratingRange[1]],
      contentRatings: filterState.contentRatings.slice(),
      country: filterState.country,
      selectedPlatform: filterState.selectedPlatform,
      selectedTitle: filterState.selectedTitle,
      sourceChart: filterState.sourceChart,
      year: filterState.year,
      selectedItems: filterState.selectedItems.map(function (it) {
        return { category: it.category, series: it.series };
      }),
      dimensions: copyDimensions(filterState.dimensions),
      brushedRange: filterState.brushedRange
        ? [filterState.brushedRange[0], filterState.brushedRange[1]]
        : null,
      sourceView: filterState.sourceView,
      action: filterState.action,
    };
  }

  function setUpdateAllCharts(fn) {
    if (typeof fn === "function") {
      updateAllChartsHandler = fn;
    }
  }

  function getDefaultFilters() {
    return {
      platforms: [],
      genre: "All",
      ratingRange: [0, 10],
      contentRatings: [],
      country: null,
      selectedPlatform: null,
      selectedTitle: null,
      sourceChart: null,
      year: null,
      selectedItems: [],
      dimensions: {},
      brushedRange: null,
      sourceView: "",
      action: "",
    };
  }

  global.getFilters = getFilters;
  global.updateFilters = updateFilters;
  global.setUpdateAllCharts = setUpdateAllCharts;
  global.getDefaultFilters = getDefaultFilters;
  global.mergeDimensionRange = mergeDimensionRange;
  global.subscribe = subscribe;
  global.subscribeFilters = subscribe;
  global.rowMatchesDimensions = rowMatchesDimensions;
  global.computeActiveRegionSet = computeActiveRegionSet;
})(typeof window !== "undefined" ? window : globalThis);
