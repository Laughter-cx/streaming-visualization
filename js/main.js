/**
 * 入口：先加载 streaming_data.json，再初始化控件与各图，并统一订阅全局筛选，协调重绘。
 */

(function (global) {
  var appStarted = false;
  var chartsBootstrapped = false;
  var resizeRAF = null;
  var resizeBound = false;

  function updateAllCharts() {
    console.log("[updateAllCharts] called");
    if (typeof global.hideTooltip === "function") {
      global.hideTooltip();
    }
    [
      global.redrawFilterPanel,
      global.redrawNewBubbleChart,
      global.redrawNewRadarChart,
      global.redrawStackedBar,
      global.redrawParallelCoords,
    ].forEach(function (fn) {
      if (typeof fn !== "function") return;
      try {
        fn();
      } catch (err) {
        console.error("[viz] redraw error:", err);
      }
    });
  }

  function startAfterDataReady() {
    if (!global.d3) {
      console.warn(
        "[viz] D3 未加载：请检查网络或 CDN，图表将无法绘制。"
      );
    }

    if (typeof global.initYearSlider === "function") {
      global.initYearSlider();
    }
    if (typeof global.initFilterPanel === "function") {
      global.initFilterPanel();
    }
    if (typeof global.initNewBubbleChart === "function") {
      global.initNewBubbleChart();
    }
    if (typeof global.initNewRadarChart === "function") {
      global.initNewRadarChart();
    }
    if (typeof global.initStackedBar === "function") {
      global.initStackedBar();
    }
    if (typeof global.initParallelCoords === "function") {
      global.initParallelCoords();
    }
    if (typeof global.setUpdateAllCharts === "function" && !chartsBootstrapped) {
      global.setUpdateAllCharts(updateAllCharts);
      chartsBootstrapped = true;
    }
    if (!resizeBound) {
      global.addEventListener("resize", function () {
        if (resizeRAF != null) return;
        resizeRAF = global.requestAnimationFrame(function () {
          resizeRAF = null;
          updateAllCharts();
        });
      });
      resizeBound = true;
    }
    updateAllCharts();
  }

  function init() {
    if (appStarted) return;
    appStarted = true;

    if (typeof global.loadStreamingData === "function") {
      global
        .loadStreamingData()
        .then(function () {
          startAfterDataReady();
        })
        .catch(function (err) {
          console.error("[viz] streaming_data.json 加载失败：", err);
        });
    } else {
      console.error("[viz] 缺少 loadStreamingData，请引入 js/dataLoader.js");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  global.updateAllCharts = updateAllCharts;
  global.renderAllCharts = updateAllCharts;
})(typeof window !== "undefined" ? window : globalThis);
