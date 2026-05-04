/**
 * 统一从 data/streaming_data.json 加载流媒体记录（全应用唯一数据源，只 fetch 一次）。
 * Phase 5：按 release_year 过滤结果缓存，避免多图多次 filter 全表。
 */

(function (global) {
  var DATA_URL = "data/streaming_data.json";
  var cache = null;
  var normalizedCache = null;
  var loadPromise = null;
  var yearFilterCacheKey = null;
  var yearFilterCacheList = null;
  var CONTENT_RATING_ORDER = [
    "G",
    "PG",
    "PG-13",
    "R",
    "NC-17",
    "TV-Y",
    "TV-Y7",
    "TV-G",
    "TV-PG",
    "TV-14",
    "TV-MA",
  ];

  function toStringSafe(v) {
    if (v == null) return "";
    return String(v).trim();
  }

  function parseNumberSafe(v) {
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v !== "string") return null;
    var raw = v.trim();
    // 避免把分级文本（如 PG-13 / TV-MA）误解析成数值。
    if (!/^\d+(\.\d+)?$/.test(raw)) return null;
    var n = Number(raw);
    return isNaN(n) ? null : n;
  }

  function normalizeList(value) {
    if (Array.isArray(value)) {
      return value
        .map(function (v) {
          return toStringSafe(v);
        })
        .filter(Boolean);
    }
    var s = toStringSafe(value);
    if (!s) return [];
    return s
      .split(",")
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean);
  }

  function pickFirstNonEmpty(obj, keys) {
    var i;
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      if (v == null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      return v;
    }
    return null;
  }

  function normalizeRecord(raw) {
    var title = toStringSafe(pickFirstNonEmpty(raw, ["title", "name"]));
    var platform = toStringSafe(pickFirstNonEmpty(raw, ["platform", "source_platform"]));
    var genreList = normalizeList(pickFirstNonEmpty(raw, ["genre", "genres", "listed_in"]));
    var countryList = normalizeList(
      pickFirstNonEmpty(raw, ["country", "production_country", "countries"])
    );
    var country = countryList.length ? countryList[0] : "Unknown";
    var rating = parseNumberSafe(
      pickFirstNonEmpty(raw, ["score", "imdb_score", "rating_score", "vote_average"])
    );
    var contentRating = toStringSafe(
      pickFirstNonEmpty(raw, ["rating", "content_rating", "maturity_rating"])
    );
    var releaseYear = parseNumberSafe(pickFirstNonEmpty(raw, ["release_year", "year"]));
    var description = toStringSafe(pickFirstNonEmpty(raw, ["description", "overview", "summary"]));
    var poster = toStringSafe(
      pickFirstNonEmpty(raw, ["poster", "poster_url", "image", "thumbnail", "poster_path"])
    );
    return {
      title: title || "Unknown Title",
      platform: platform || "Unknown Platform",
      genre: genreList.length ? genreList : ["Unknown"],
      country: country || "Unknown",
      countries: countryList.length ? countryList : ["Unknown"],
      rating: rating == null ? null : rating,
      contentRating: contentRating || "Unknown",
      releaseYear: releaseYear == null ? null : releaseYear,
      description: description || "暂无简介",
      poster: poster || "",
      raw: raw,
    };
  }

  function normalizeData(rawData) {
    if (!Array.isArray(rawData)) return [];
    return rawData.map(normalizeRecord);
  }

  /**
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  function loadStreamingData() {
    if (cache) {
      return Promise.resolve(cache);
    }
    if (loadPromise) {
      return loadPromise;
    }
    loadPromise = fetch(DATA_URL)
      .then(function (res) {
        if (!res.ok) {
          throw new Error("streaming_data.json 请求失败: " + res.status);
        }
        return res.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) {
          throw new Error("streaming_data.json 应为 JSON 数组");
        }
        cache = data;
        normalizedCache = normalizeData(cache);
        yearFilterCacheKey = null;
        yearFilterCacheList = null;
        console.info("[viz] 已加载 data/streaming_data.json，共 " + cache.length + " 条");
        return cache;
      });
    return loadPromise;
  }

  /**
   * 数据未加载完成前返回 null。
   * @returns {Array<Record<string, unknown>>|null}
   */
  function getStreamingRecords() {
    return cache;
  }

  function getNormalizedRecords() {
    return normalizedCache || [];
  }

  /**
   * 按年过滤后的记录（共享、只算一次/年）。year 为 null 表示不按年过滤，使用全表。
   * @param {number|null|undefined} year
   * @returns {Array<Record<string, unknown>>}
   */
  function getYearFilteredRecords(year) {
    if (!cache || !cache.length) return [];
    var k =
      year == null || typeof year !== "number" || isNaN(year)
        ? "all"
        : "y:" + String(year);
    if (yearFilterCacheKey === k && yearFilterCacheList) {
      return yearFilterCacheList;
    }
    var out;
    if (k === "all") {
      out = cache;
    } else {
      out = cache.filter(function (r) {
        return r.release_year === year;
      });
    }
    yearFilterCacheKey = k;
    yearFilterCacheList = out;
    return out;
  }

  function recordMatchesFilters(item, filters) {
    if (!item) return false;
    var fs = filters || {};
    if (Array.isArray(fs.platforms) && fs.platforms.length > 0) {
      if (fs.platforms.indexOf(item.platform) === -1) return false;
    }
    if (fs.genre && fs.genre !== "All") {
      var hasGenre = Array.isArray(item.genre) && item.genre.indexOf(String(fs.genre)) !== -1;
      if (!hasGenre) return false;
    }
    if (Array.isArray(fs.contentRatings) && fs.contentRatings.length > 0) {
      if (fs.contentRatings.indexOf(item.contentRating) === -1) return false;
    }
    if (Array.isArray(fs.ratingRange) && fs.ratingRange.length >= 2) {
      var minR = Number(fs.ratingRange[0]);
      var maxR = Number(fs.ratingRange[1]);
      if (item.rating != null && (item.rating < minR || item.rating > maxR)) {
        return false;
      }
    }
    if (fs.country && item.country !== fs.country) {
      return false;
    }
    if (fs.selectedPlatform && item.platform !== fs.selectedPlatform) {
      return false;
    }
    if (typeof fs.year === "number" && !isNaN(fs.year)) {
      var y = item.releaseYear;
      if (y == null || y !== fs.year) return false;
    }
    return true;
  }

  function getFilteredData(filters) {
    var source = getNormalizedRecords();
    if (!source.length) return [];
    var fs = filters;
    if (!fs && typeof global.getFilters === "function") {
      fs = global.getFilters();
    }
    return source.filter(function (item) {
      return recordMatchesFilters(item, fs);
    });
  }

  function getFilteredRawRecords(filters) {
    return getFilteredData(filters).map(function (item) {
      return item.raw;
    });
  }

  function getDistinctPlatforms() {
    var set = new Set();
    getNormalizedRecords().forEach(function (item) {
      if (item.platform) set.add(item.platform);
    });
    return Array.from(set).sort();
  }

  function getDistinctGenres(filters) {
    var set = new Set();
    var fs = filters;
    if (!fs && typeof global.getFilters === "function") {
      fs = global.getFilters();
    }
    var candidateFilters = Object.assign({}, fs || {}, {
      genre: "All",
    });
    getNormalizedRecords().forEach(function (item) {
      if (!recordMatchesFilters(item, candidateFilters)) return;
      (item.genre || []).forEach(function (g) {
        if (g) set.add(g);
      });
    });
    return Array.from(set).sort();
  }

  function getDistinctContentRatings() {
    var set = new Set();
    getNormalizedRecords().forEach(function (item) {
      if (item.contentRating && !isUnknownCategory(item.contentRating)) {
        set.add(item.contentRating);
      }
    });
    return Array.from(set).sort(function (a, b) {
      var ai = CONTENT_RATING_ORDER.indexOf(a);
      var bi = CONTENT_RATING_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.localeCompare(b);
    });
  }

  function isUnknownCategory(value) {
    if (value === null || value === undefined) return true;
    var v = String(value).trim().toLowerCase();
    return (
      v === "" ||
      v === "unknown" ||
      v === "unknow" ||
      v === "n/a" ||
      v === "na" ||
      v === "null" ||
      v === "undefined" ||
      v === "-" ||
      v === "无" ||
      v === "未知"
    );
  }

  global.loadStreamingData = loadStreamingData;
  global.getStreamingRecords = getStreamingRecords;
  global.normalizeData = normalizeData;
  global.getNormalizedRecords = getNormalizedRecords;
  global.getYearFilteredRecords = getYearFilteredRecords;
  global.getFilteredData = getFilteredData;
  global.getFilteredRawRecords = getFilteredRawRecords;
  global.getDistinctPlatforms = getDistinctPlatforms;
  global.getDistinctGenres = getDistinctGenres;
  global.getDistinctContentRatings = getDistinctContentRatings;
  global.isUnknownCategory = isUnknownCategory;
})(typeof window !== "undefined" ? window : globalThis);
