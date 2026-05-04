(function (global) {
  var tooltipEl = null;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "viz-tooltip";
    tooltipEl.style.opacity = "0";
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function safeText(v, fallback) {
    if (v == null || String(v).trim() === "") return fallback || "";
    return String(v);
  }

  function shorten(text, maxLen) {
    var t = safeText(text, "");
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen - 1) + "...";
  }

  function showTooltip(payload, x, y) {
    var el = ensureTooltip();
    var title = safeText(payload && payload.title, "未知片名");
    var rating = payload && payload.rating != null ? String(payload.rating) : "暂无";
    var ratingLabel = safeText(payload && payload.ratingLabel, "内容分级");
    var description = shorten(payload && payload.description, 100) || "暂无简介";
    var poster = safeText(payload && payload.poster, "");
    var subtitle = safeText(payload && payload.subtitle, "");
    var metrics = payload && payload.metrics ? payload.metrics : [];
    var metricHtml = metrics.length
      ? '<div class="viz-tooltip__metrics">' +
        metrics
          .map(function (m) {
            return (
              '<div><span class="k">' +
              safeText(m.label, "") +
              ":</span> <span class=\"v\">" +
              safeText(m.value, "暂无") +
              "</span></div>"
            );
          })
          .join("") +
        "</div>"
      : "";

    el.innerHTML =
      '<div class="viz-tooltip__content">' +
      (poster
        ? '<img class="viz-tooltip__poster" src="' + poster + '" alt="poster" />'
        : '<div class="viz-tooltip__poster viz-tooltip__poster--placeholder">暂无海报</div>') +
      '<div class="viz-tooltip__text">' +
      (subtitle ? '<div class="viz-tooltip__subtitle">' + subtitle + "</div>" : "") +
      '<div class="viz-tooltip__title">' + title + "</div>" +
      '<div class="viz-tooltip__rating">' + ratingLabel + ": " + rating + "</div>" +
      '<div class="viz-tooltip__desc">' + description + "</div>" +
      metricHtml +
      "</div></div>";

    var px = Number(x) || 0;
    var py = Number(y) || 0;
    el.style.left = px + 14 + "px";
    el.style.top = py + 14 + "px";
    el.style.opacity = "1";
  }

  function moveTooltip(x, y) {
    if (!tooltipEl) return;
    tooltipEl.style.left = (Number(x) || 0) + 14 + "px";
    tooltipEl.style.top = (Number(y) || 0) + 14 + "px";
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.style.opacity = "0";
  }

  global.showTooltip = showTooltip;
  global.moveTooltip = moveTooltip;
  global.hideTooltip = hideTooltip;
})(typeof window !== "undefined" ? window : globalThis);
