/**
 * 年份滑块：范围从已加载的 streaming_data.json（getStreamingRecords）推断 release_year 的 min/max；
 * 数据未就绪或无法读取（如 file:// 下未走 HTTP）时使用 MOCK 范围。
 */

(function (global) {
  /** 本地打开或请求失败时的回退范围 */
  var MOCK_YEAR_RANGE = { min: 2015, max: 2024 };

  var SLIDER_ID = "year-slider";
  var LABEL_ID = "year-slider-value";
  var UPDATE_DEBOUNCE_MS = 120;

  /**
   * @param {Array<{ release_year?: unknown }>} records
   * @returns {{ min: number, max: number } | null}
   */
  function inferYearBounds(records) {
    if (!Array.isArray(records) || !records.length) return null;
    var minY = Infinity;
    var maxY = -Infinity;
    var i;
    var y;
    for (i = 0; i < records.length; i++) {
      y = records[i].release_year;
      if (typeof y === "number" && !isNaN(y)) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (minY === Infinity) return null;
    return { min: minY, max: maxY };
  }

  /**
   * @param {HTMLInputElement} slider
   * @param {{ min: number, max: number }} bounds
   */
  function applyRange(slider, bounds) {
    slider.min = String(bounds.min);
    slider.max = String(bounds.max);
    slider.step = "1";
    var v = Number(slider.value);
    if (isNaN(v) || v < bounds.min || v > bounds.max) {
      slider.value = String(bounds.max);
    }
  }

  function syncLabel(slider, labelEl) {
    labelEl.textContent = String(slider.value);
  }

  /**
   * 绑定滑块：拖动时先更新文案，再用短延迟提交筛选，避免连续重绘引发布局抖动。
   * @param {HTMLInputElement} slider
   * @param {HTMLElement} labelEl
   */
  function bindSlider(slider, labelEl) {
    var debounceTimer = null;
    function commitYear(action) {
      if (debounceTimer != null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (typeof global.updateFilters !== "function") return;
      var year = Number(slider.value);
      global.updateFilters({
        year: year,
        sourceView: "yearSlider",
        action: action || "input",
      });
    }
    slider.addEventListener("input", function onYearInput() {
      syncLabel(slider, labelEl);
      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        commitYear("input");
      }, UPDATE_DEBOUNCE_MS);
    });
    slider.addEventListener("change", function onYearChange() {
      syncLabel(slider, labelEl);
      commitYear("change");
    });
  }

  /**
   * 首次将当前滑块年份写入全局状态。
   */
  function commitInitialYear(slider) {
    var year = Number(slider.value);
    if (typeof global.updateFilters === "function") {
      global.updateFilters({
        year: year,
        sourceView: "yearSlider",
        action: "init",
      });
    }
  }

  /**
   * @param {{ min: number, max: number }} bounds
   */
  function setup(slider, labelEl, bounds) {
    applyRange(slider, bounds);
    syncLabel(slider, labelEl);
    commitInitialYear(slider);
    bindSlider(slider, labelEl);
  }

  /**
   * 必须在 loadStreamingData 成功之后调用，与柱图/平行坐标共用同一份记录。
   */
  function initYearSlider() {
    var slider = document.getElementById(SLIDER_ID);
    var labelEl = document.getElementById(LABEL_ID);
    if (!slider || !labelEl) return;

    var records =
      typeof global.getStreamingRecords === "function" ? global.getStreamingRecords() : null;
    var inferred = records && records.length ? inferYearBounds(records) : null;
    setup(slider, labelEl, inferred || MOCK_YEAR_RANGE);
  }

  global.initYearSlider = initYearSlider;
})(typeof window !== "undefined" ? window : globalThis);
