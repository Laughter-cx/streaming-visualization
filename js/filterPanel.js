(function (global) {
  var CONTAINER_ID = "global-filter-panel";
  var inSync = false;

  var PLATFORM_SWATCH_CLASS = {
    Netflix: "streaming-filter-swatch--netflix",
    "Disney+": "streaming-filter-swatch--disney",
    "Amazon Prime": "streaming-filter-swatch--prime",
  };

  function createIfMissing(container) {
    if (container.querySelector(".streaming-filter-panel")) return;
    container.innerHTML =
      '<section class="filter-panel streaming-filter-panel" aria-label="全局筛选器">' +
      '<div class="streaming-filter-panel__head">' +
      '<h2 class="streaming-filter-panel__title">筛选条件</h2>' +
      '<p class="streaming-filter-panel__hint">选择平台、类型或分级后，右侧图表会同步更新。</p>' +
      "</div>" +
      '<div class="filter-group streaming-filter-group" id="filter-platforms"></div>' +
      '<div class="filter-group streaming-filter-group">' +
      '<label for="filter-genre-select">类型</label>' +
      '<select id="filter-genre-select"></select>' +
      "</div>" +
      '<div class="filter-group streaming-filter-group" id="filter-content-ratings"></div>' +
      '<div class="filter-group streaming-filter-group streaming-filter-group--actions">' +
      '<button type="button" id="filter-reset-btn">重置筛选</button>' +
      "</div>" +
      '<div class="filter-group streaming-filter-group streaming-filter-group--actions">' +
      '<button type="button" id="view-doc-btn">查看文档</button>' +
      "</div>" +
      "</section>";
  }

  function wireGlobalFilterControls(container) {
    var platformsHost = container.querySelector("#filter-platforms");
    var genreSelect = container.querySelector("#filter-genre-select");
    var contentRatingsHost = container.querySelector("#filter-content-ratings");
    var resetBtn = container.querySelector("#filter-reset-btn");
    if (!platformsHost || !genreSelect || !contentRatingsHost || !resetBtn) return;

    platformsHost.addEventListener("change", function () {
      if (inSync) return;
      var selected = Array.from(platformsHost.querySelectorAll('input[type="checkbox"]:checked')).map(
        function (el) {
          return el.value;
        }
      );
      global.updateFilters({
        platforms: selected,
        sourceChart: "filterPanel",
        sourceView: "globalFilterPanel",
        action: "platformChange",
      });
    });

    genreSelect.addEventListener("change", function () {
      if (inSync) return;
      global.updateFilters({
        genre: genreSelect.value || "All",
        sourceChart: "filterPanel",
        sourceView: "globalFilterPanel",
        action: "genreChange",
      });
    });

    contentRatingsHost.addEventListener("change", function () {
      if (inSync) return;
      var selected = Array.from(contentRatingsHost.querySelectorAll('input[type="checkbox"]:checked')).map(
        function (el) {
          return el.value;
        }
      );
      global.updateFilters({
        contentRatings: selected,
        sourceChart: "filterPanel",
        sourceView: "globalFilterPanel",
        action: "contentRatingChange",
      });
    });

    resetBtn.addEventListener("click", function () {
      resetGlobalFilters();
    });

    var viewDocBtn = container.querySelector("#view-doc-btn");
    if (viewDocBtn) {
      viewDocBtn.addEventListener("click", function () {
        window.open("doc.html", "_blank");
      });
    }
  }

  function resetGlobalFilters() {
    var defaults =
      typeof global.getDefaultFilters === "function" ? global.getDefaultFilters() : {};
    var current = typeof global.getFilters === "function" ? global.getFilters() : {};
    global.updateFilters({
      platforms: defaults.platforms || [],
      genre: defaults.genre || "All",
      ratingRange: defaults.ratingRange || [0, 10],
      contentRatings: defaults.contentRatings || [],
      country: null,
      selectedPlatform: null,
      selectedTitle: null,
      selectedItems: [],
      dimensions: {},
      brushedRange: null,
      year: current.year,
      sourceChart: "filterPanel",
      sourceView: "globalFilterPanel",
      action: "reset",
    });
  }

  function renderPlatformOptions(host, selectedPlatforms) {
    var platforms =
      typeof global.getDistinctPlatforms === "function" ? global.getDistinctPlatforms() : [];
    if (!platforms.length) {
      host.innerHTML = "<label>平台</label><div class='filter-hint'>暂无可选平台</div>";
      return;
    }
    host.innerHTML =
      "<label>平台</label>" +
      '<div class="platform-checkboxes">' +
      platforms
        .map(function (p, idx) {
          var checked = selectedPlatforms.indexOf(p) !== -1 ? "checked" : "";
          return (
            '<label class="platform-checkbox" for="platform-' +
            idx +
            '">' +
            '<input type="checkbox" id="platform-' +
            idx +
            '" value="' +
            p +
            '" ' +
            checked +
            "/>" +
            '<span class="streaming-filter-swatch ' +
            (PLATFORM_SWATCH_CLASS[p] || "streaming-filter-swatch--default") +
            '"></span>' +
            "<span>" +
            p +
            "</span></label>"
          );
        })
        .join("") +
      "</div>";
  }

  function renderGenreOptions(selectEl, selectedGenre, filters) {
    var genres = typeof global.getDistinctGenres === "function" ? global.getDistinctGenres(filters) : [];
    var activeGenre = selectedGenre || "All";
    selectEl.innerHTML = "";
    selectEl.appendChild(new Option("全部类型", "All", activeGenre === "All", activeGenre === "All"));
    genres.forEach(function (g) {
      selectEl.appendChild(new Option(g, g, g === activeGenre, g === activeGenre));
    });
    return activeGenre === "All" || genres.indexOf(activeGenre) !== -1;
  }

  function renderContentRatingOptions(host, selectedRatings) {
    var ratings =
      typeof global.getDistinctContentRatings === "function" ? global.getDistinctContentRatings() : [];
    if (!ratings.length) {
      host.innerHTML = "<label>内容分级</label><div class='filter-hint'>暂无可选分级</div>";
      return;
    }
    host.innerHTML =
      "<label>内容分级</label>" +
      '<div class="platform-checkboxes content-rating-checkboxes">' +
      ratings
        .map(function (rating, idx) {
          var checked = selectedRatings.indexOf(rating) !== -1 ? "checked" : "";
          return (
            '<label class="platform-checkbox content-rating-checkbox" for="content-rating-' +
            idx +
            '">' +
            '<input type="checkbox" id="content-rating-' +
            idx +
            '" value="' +
            rating +
            '" ' +
            checked +
            "/>" +
            "<span>" +
            rating +
            "</span></label>"
          );
        })
        .join("") +
      "</div>";
  }

  function syncGlobalFilterUI(filters, container) {
    var platformsHost = container.querySelector("#filter-platforms");
    var genreSelect = container.querySelector("#filter-genre-select");
    var contentRatingsHost = container.querySelector("#filter-content-ratings");
    renderPlatformOptions(platformsHost, filters.platforms || []);
    var genreIsValid = renderGenreOptions(genreSelect, filters.genre || "All", filters);
    renderContentRatingOptions(contentRatingsHost, filters.contentRatings || []);
    if (!genreIsValid && !container.__genreResetPending) {
      container.__genreResetPending = true;
      global.setTimeout(function () {
        container.__genreResetPending = false;
        if (typeof global.getFilters !== "function" || typeof global.updateFilters !== "function") return;
        var latest = global.getFilters();
        if (latest.genre && latest.genre !== "All") {
          global.updateFilters({
            genre: "All",
            sourceChart: "filterPanel",
            sourceView: "globalFilterPanel",
            action: "resetInvalidGenre",
          });
        }
      }, 0);
    }
  }

  function renderFilterPanel() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container || typeof global.getFilters !== "function") return;
    createIfMissing(container);
    var filters = global.getFilters();
    inSync = true;
    syncGlobalFilterUI(filters, container);
    inSync = false;
    if (!container.__binded) {
      wireGlobalFilterControls(container);
      container.__binded = true;
    }
  }

  function initFilterPanel() {
    renderFilterPanel();
  }

  global.initFilterPanel = initFilterPanel;
  global.renderFilterPanel = renderFilterPanel;
  global.redrawFilterPanel = renderFilterPanel;
  global.syncGlobalFilterUI = function () {
    var container = document.getElementById(CONTAINER_ID);
    if (container && typeof global.getFilters === "function") {
      syncGlobalFilterUI(global.getFilters(), container);
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
