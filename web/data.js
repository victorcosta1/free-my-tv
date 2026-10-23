/*
 * What the home screen shows, kept in localStorage so it opens with numbers:
 *  - the picks: what's trending this week and recent releases, only from the streaming apps on this TV (TMDB, with
 *    the person's own free key from config.properties), three per hour;
 *  - weather, sunrise and sunset (Open-Meteo, every 30 min) and optional crypto prices (Binance, every 5 min).
 * Settings changed on the TV (Prefs) win over config.properties, as on Android. Built without a city (--generic), the
 * TV's time zone gives the city, and its country the currency and the region (zones.js).
 */
var CONFIG = window.CONFIG || {};

var Place = (function () {
  'use strict';
  var EURO = /^(AT|BE|CY|DE|EE|ES|FI|FR|GR|HR|IE|IT|LT|LU|LV|MT|NL|PT|SI|SK)$/;

  /** A time zone's main city: {country, lat, lon, name}, or null. */
  function zone(name) {
    var all = window.ZONES || {}, v = all[name], hops = 0;
    while (v && v.charAt(0) === '=' && hops++ < 3) { name = v.slice(1); v = all[name]; }
    if (!v) return null;
    var p = v.split(',');
    return {country: p[0], lat: p[1], lon: p[2], name: p[3] || name.slice(name.lastIndexOf('/') + 1).replace(/_/g, ' ')};
  }

  var tz = zone(TV.zone()), set = CONFIG.latitude !== '' && CONFIG.latitude !== undefined;
  var country = (CONFIG.tmdbRegion || (tz ? tz.country : '') || 'US').toUpperCase();
  return {
    lat: set ? CONFIG.latitude : tz ? tz.lat : '40.7128',
    lon: set ? CONFIG.longitude : tz ? tz.lon : '-74.0060',
    city: CONFIG.city || (!set && tz ? tz.name : ''),
    country: country,
    currency: (CONFIG.currency || (country === 'BR' ? 'BRL' : EURO.test(country) ? 'EUR' : 'USD')).toUpperCase(),
    /** Fahrenheit for TVs in the US (by their time zone, or their language when it doesn't tell). */
    fahrenheit: tz ? tz.country === 'US' : /-US$/i.test(navigator.language || '')
  };
})();

var Prefs = (function () {
  'use strict';
  var KEY = 'fmtv.prefs';
  var v = {};
  try { v = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function pick(name, fallback) { return v[name] === undefined ? fallback : v[name]; }
  return {
    version: 0,
    language: function () { return pick('language', CONFIG.language || 'auto'); },
    temperature: function () { return pick('temperature', CONFIG.temperature || 'auto'); },
    theme: function () { return pick('theme', 'auto'); },
    weather: function () { return pick('weather', true); },
    quotes: function () { return pick('quotes', CONFIG.showCrypto !== false); },
    coin: function (i) { var c = pick('coins', null); return c ? c[i] !== false : true; },
    shelf: function () { return pick('shelf', null); },
    set: function (name, value) { v[name] = value; save(); this.version++; },
    setCoin: function (i, on) {
      var c = (pick('coins', null) || [true, true, true, true]).slice();
      c[i] = on;
      this.set('coins', c);
    }
  };
})();

var Data = (function () {
  'use strict';

  function store(key, value) { try { localStorage.setItem('fmtv.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.' + key)); } catch (e) { return null; } }

  /** GET a JSON document; done(error, json). */
  function get(url, headers, done) {
    var x = new XMLHttpRequest();
    var over = false;
    x.open('GET', url, true);
    x.timeout = 10000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(new Error(x.status === 401 ? 'TMDB rejected the key' : 'HTTP ' + x.status)); return; }
      var json;
      try { json = JSON.parse(x.responseText); } catch (e) { done(e); return; }
      done(null, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    x.send();
  }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  // MARK: - Weather

  var PLACE = Place.lat + ',' + Place.lon;
  var weather = null, weatherAt = 0, fetchingWeather = false;
  (function () {
    var w = stored('weather');
    if (w && w.place === PLACE) { weather = parseWeather(w.body); weatherAt = w.at; }
  })();

  /** "2026-10-20T18:31" at the location (Open-Meteo's local time) → epoch ms. */
  function localTime(iso, offsetSeconds) {
    var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(iso || '');
    if (!m) return 0;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - offsetSeconds * 1000;
  }

  function parseWeather(o) {
    if (!o || !o.current) return null;
    var off = o.utc_offset_seconds || 0, now = Date.now();
    var w = {
      temp: o.current.temperature_2m, code: o.current.weather_code, isDay: o.current.is_day !== 0,
      max: o.daily.temperature_2m_max[0], min: o.daily.temperature_2m_min[0],
      sunrise: localTime(o.daily.sunrise[0], off), sunset: localTime(o.daily.sunset[0], off), hours: []
    };
    var hr = o.hourly;
    for (var i = 0; hr && i < hr.time.length && w.hours.length < 6; i++) {
      var at = localTime(hr.time[i], off);
      if (at <= now) continue;
      w.hours.push({at: at, temp: hr.temperature_2m[i], code: hr.weather_code[i], day: !hr.is_day || hr.is_day[i] !== 0});
    }
    return w;
  }

  function refreshWeather() {
    var now = Date.now();
    if (fetchingWeather || (now - weatherAt < 30 * 60000 && now >= weatherAt)) return;
    fetchingWeather = true;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + Place.lat + '&longitude=' + Place.lon
        + '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset'
        + '&hourly=temperature_2m,weather_code,is_day&timezone=auto&forecast_days=2';
    get(url, {}, function (err, body) {
      fetchingWeather = false;
      if (err) return;
      weather = parseWeather(body);
      weatherAt = Date.now();
      store('weather', {place: PLACE, body: body, at: weatherAt});
      changed();
    });
  }

  // MARK: - Prices

  var COINS = ['BTC', 'ETH', 'SOL', 'USDT'];
  var CURRENCY = Place.currency;
  var QUOTE = CURRENCY === 'USD' ? 'USDT' : CURRENCY;
  /** Binance refuses the whole request when it has no pairs in the currency (INR...): the prices go in dollars then. */
  function inDollars() {
    store('dollarsFor', CURRENCY);
    CURRENCY = 'USD';
    QUOTE = 'USDT';
  }
  if (stored('dollarsFor') === CURRENCY && CURRENCY !== 'USD') {
    CURRENCY = 'USD';
    QUOTE = 'USDT';
  }
  var prices = [NaN, NaN, NaN, NaN], changes = [NaN, NaN, NaN, NaN], pricesAt = 0, fetchingPrices = false;

  /** Indexes in COINS of the coins that are on (the dollar only in Brazilian reais, where Binance lists it). */
  function activeCoins() {
    var out = [];
    if (!Prefs.quotes()) return out;
    for (var i = 0; i < COINS.length; i++) if (Prefs.coin(i) && (i < 3 || CURRENCY === 'BRL')) out.push(i);
    return out;
  }

  function parsePrices(list) {
    var found = 0;
    for (var i = 0; list && i < list.length; i++) {
      for (var k = 0; k < COINS.length; k++) {
        if (list[i].symbol !== COINS[k] + QUOTE) continue;
        found++;
        var last = parseFloat(list[i].lastPrice), open = parseFloat(list[i].openPrice);
        prices[k] = last;
        changes[k] = open > 0 ? (last - open) / open * 100 : NaN;
      }
    }
    return found;
  }

  (function () {
    var p = stored('prices');
    if (p && p.quote === QUOTE && parsePrices(p.body)) pricesAt = p.at;
  })();

  function refreshPrices() {
    var coins = activeCoins(), now = Date.now();
    if (!coins.length || fetchingPrices || (now - pricesAt < 5 * 60000 && now >= pricesAt)) return;
    fetchingPrices = true;
    var symbols = coins.map(function (i) { return '%22' + COINS[i] + QUOTE + '%22'; }).join(',');
    var path = '/api/v3/ticker/24hr?type=MINI&symbols=%5B' + symbols + '%5D';
    // Binance.com refuses the US (HTTP 451); Binance.US answers the same call in dollars.
    var hosts = ['https://api.binance.com', 'https://api.binance.us'];
    (function next(h, refused) {
      get(hosts[h] + path, {}, function (err, body) {
        // A pair Binance doesn't list (HTTP 400): the prices go in dollars. Binance.US has only dollar pairs: its 400
        // counts only where Binance.com refuses the US (HTTP 451), not after a timeout or a 5xx there.
        if (err && err.message === 'HTTP 400' && QUOTE !== 'USDT' && (h === 0 || refused)) { fetchingPrices = false; inDollars(); refreshPrices(); return; }
        if (err || !parsePrices(body)) {
          if (h + 1 < hosts.length && !(err && err.message === 'HTTP 400')) next(h + 1, err && err.message === 'HTTP 451');
          else fetchingPrices = false;
          return;
        }
        fetchingPrices = false;
        pricesAt = Date.now();
        store('prices', {quote: QUOTE, body: body, at: pricesAt});
        changed();
      });
    })(0);
  }

  // MARK: - Picks (TMDB)

  var KEY = (CONFIG.tmdbKey || '').trim();
  var REGION = Place.country;
  var API = 'https://api.themoviedb.org/3';

  /** Service name on TMDB (part of it, lowercase) → our key, how to find its app on the TV (id, name), its name. */
  var SERVICES = [
    ['netflix', 'netflix', /^netflix$/, /netflix/i, 'Netflix'],
    ['prime video', 'prime', /^amazon$/, /prime video|amazon/i, 'Prime Video'],
    ['disney', 'disney', /disney/, /disney/i, 'Disney+'],
    ['hulu', 'hulu', /^hulu/, /hulu/i, 'Hulu'],
    ['paramount', 'paramount', /paramount|cbs/, /paramount/i, 'Paramount+'],
    ['peacock', 'peacock', /peacock/, /peacock/i, 'Peacock'],
    ['globoplay', 'globoplay', /globoplay/, /globoplay/i, 'Globoplay'],
    ['max', 'max', /hbo|wbd|\.max/, /^(hbo )?max$|hbo max/i, 'Max'],
    ['apple tv', 'appletv', /appletv|apple\.tv/, /apple tv/i, 'Apple TV'],
    ['hotstar', 'hotstar', /hotstar/, /hotstar/i, 'JioHotstar'],
    ['crunchyroll', 'crunchyroll', /crunchyroll/, /crunchyroll/i, 'Crunchyroll']
  ];

  var installed = [];   // the TV's apps, from TV.apps()

  /** The installed app for a service key, or null. */
  function appFor(key) {
    for (var s = 0; s < SERVICES.length; s++) {
      if (SERVICES[s][1] !== key) continue;
      for (var i = 0; i < installed.length; i++) {
        if (SERVICES[s][2].test(installed[i].id) || SERVICES[s][3].test(installed[i].title)) return installed[i];
      }
    }
    return null;
  }

  function service(providerName) {
    var n = (providerName || '').toLowerCase();
    for (var i = 0; i < SERVICES.length; i++) {
      var s = SERVICES[i];
      if (s[0] === 'max' ? /\bmax\b/.test(n) : n.indexOf(s[0]) >= 0) return s;
    }
    return null;
  }

  function tmdb(path, done) {
    var bearer = KEY.indexOf('eyJ') === 0;   // read access token (v4) or API key (v3)
    var url = API + path + (bearer ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(KEY));
    get(url, bearer ? {Authorization: 'Bearer ' + KEY, Accept: 'application/json'} : {Accept: 'application/json'}, done);
  }

  var cache = stored('recs') || {};
  var picks = cache.picks || [], listAt = cache.listAt || 0, period = cache.period, listLang = cache.lang || '', stamp = cache.stamp || '';
  var fetchingRecs = false, failedAt = 0, recsError = '';

  function saveRecs() { store('recs', {picks: picks, listAt: listAt, period: period, lang: listLang, stamp: stamp}); }

  function hourPeriod(d) {
    var h = d.getHours();
    return h >= 5 && h < 12 ? 0 : h >= 12 && h < 18 ? 1 : 2;
  }

  function sourceStamp() {
    var s = KEY.length + ':' + KEY.slice(-6) + ':' + REGION + (CONFIG.hideAnimation ? ':no-animation' : '');
    for (var i = 0; i < SERVICES.length; i++) s += appFor(SERVICES[i][1]) ? '1' : '0';
    return s;
  }

  function franchise(title) {
    var t = (title || '').toLowerCase(), cut = t.indexOf(':');
    if (cut < 0) cut = t.indexOf(' - ');
    return (cut > 0 ? t.slice(0, cut) : t).replace(/^\s+|\s+$/g, '');
  }

  /** This hour's 3 picks: movies ("movie"), shows ("tv") or both (null). */
  function now(kind) {
    var list = [];
    if (!KEY) return list;
    for (var i = 0; i < picks.length; i++) {
      var p = picks[i];
      if ((kind === null || kind === p.kind) && (!p.detailed || (p.app && appFor(p.app)))) list.push(p);
    }
    if (!list.length) return list;
    var hour = Math.floor(Date.now() / 3600000), out = [], seen = {};
    for (var j = 0; j < list.length && out.length < 3; j++) {
      var q = list[(hour * 3 + j) % list.length], f = franchise(q.title);
      if (!seen[f]) { seen[f] = true; out.push(q); }
    }
    return out;
  }

  /** TMDB's language, as on Android: Latin American Spanish unless the TV is in Spain, and Germany's German. */
  function lang() {
    if (I18N.lang === 'es') return /-ES\b/i.test(navigator.language || '') ? 'es-ES' : 'es-MX';
    if (I18N.lang === 'de') return 'de-DE';   // TMDB's de-AT and de-CH have few translations of their own
    return I18N.locale();
  }

  function day(offset) {
    var d = new Date(Date.now() + offset * 86400000);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  /** TMDB's genres that it leaves in English in some languages. */
  function genre(name) {
    switch (name) {
      case 'Action & Adventure': return tr('genre|Action & Adventure');
      case 'Sci-Fi & Fantasy': return tr('genre|Sci-Fi & Fantasy');
      case 'War & Politics': return tr('genre|War & Politics');
      case 'Kids': return tr('genre|Kids');
      case 'News': return tr('genre|News');
      case 'Soap': return tr('genre|Soap');
      case 'Talk': return tr('genre|Talk');
      default: return name;
    }
  }

  /** The best backdrop: no text over it, the largest, then the best rated. */
  function bestBackdrop(images) {
    var list = images && images.backdrops, best = null, score = -1;
    for (var i = 0; list && i < list.length; i++) {
      var b = list[i];
      if (!b.file_path) continue;
      var s = (b.iso_639_1 === null ? 1e7 : 0) + Math.min(b.width || 0, 3840) * 100 + (b.vote_average || 0);
      if (s > score) { score = s; best = b.file_path; }
    }
    return best;
  }

  /** Genre, runtime or seasons, and the service it's on among the TV's apps. */
  function details(p, done) {
    tmdb('/' + p.kind + '/' + p.id + '?language=' + lang() + '&append_to_response=watch/providers,images&include_image_language=null,'
        + I18N.base + ',en', function (err, o) {
      if (err) { done(err); return; }
      var best = bestBackdrop(o.images);
      if (best) p.backdrop = best;
      var parts = [];
      if (p.kind === 'tv') parts.push(tr('Series'));
      if (o.genres && o.genres.length) {
        parts.push(genre(o.genres[0].name));
      }
      if (p.kind === 'movie' && o.runtime > 0) {
        var h = Math.floor(o.runtime / 60), m = o.runtime % 60;
        parts.push(h ? trf('{h}h {m}m', {h: h, m: m}) : trf('{m}m', {m: m}));
      } else if (p.kind === 'tv' && o.number_of_seasons > 0) {
        parts.push(plural('plural|one:{n} season|other:{n} seasons', o.number_of_seasons));
      }
      var wp = o['watch/providers'], here = wp && wp.results && wp.results[REGION], flat = here && here.flatrate;
      p.app = null;
      for (var i = 0; flat && i < flat.length && !p.app; i++) {
        var s = service(flat[i].provider_name);
        if (s && appFor(s[1])) { p.app = s[1]; p.service = s[4]; }
      }
      if (p.service && p.app) parts.push(p.service);
      p.meta = parts.join(' · ');
      title(p, o, function () {
        p.detailed = true;
        done(null);
      });
    });
  }

  /**
   * Without a title in the TV's language TMDB answers with the original one, so a Korean series on a German TV reads
   * "닥터X: 하얀 마피아의 시대". Then the English title, when TMDB has one (one more request, only for those).
   */
  function title(p, o, done) {
    var field = p.kind === 'movie' ? 'title' : 'name', own = o[field] || p.title;
    p.title = own;
    if (I18N.lang === 'en' || !own || own !== o['original_' + field] || o.original_language === I18N.base
        || o.original_language === 'en') { done(); return; }
    tmdb('/' + p.kind + '/' + p.id + '?language=en-US', function (err, en) {
      if (!err && en && en[field]) p.title = en[field];
      done();
    });
  }

  /** TMDB's Animation genre (movies and shows: cartoons and anime), left out with hide_animation=true. */
  var ANIMATION = 16;

  function animated(o) {
    for (var i = 0; o.genre_ids && i < o.genre_ids.length; i++) if (o.genre_ids[i] === ANIMATION) return true;
    return false;
  }

  function addPick(list, o, kind) {
    if (!o.backdrop_path) return;
    if (CONFIG.hideAnimation && animated(o)) return;
    list.push({id: o.id, kind: kind, title: kind === 'movie' ? o.title : o.name, backdrop: o.backdrop_path, meta: '', app: null, detailed: false});
  }

  function keyOf(p) { return p.kind + ':' + p.id; }

  function alternate(out, seen, a, b, max) {
    for (var i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
      if (i < a.length && !seen[keyOf(a[i])]) { seen[keyOf(a[i])] = true; out.push(a[i]); }
      if (i < b.length && out.length < max && !seen[keyOf(b[i])]) { seen[keyOf(b[i])] = true; out.push(b[i]); }
    }
  }

  /** Runs fn on each item one after the other (the TV's network is shared with what's playing). */
  function each(items, fn, done) {
    var i = 0;
    (function next() {
      if (i >= items.length) { done(); return; }
      fn(items[i++], next);
    })();
  }

  function fetchList(done) {
    tmdb('/watch/providers/movie?language=' + lang() + '&watch_region=' + REGION, function (err, res) {
      if (err) { done(err); return; }
      var ids = [];
      for (var i = 0; res.results && i < res.results.length; i++) {
        var s = service(res.results[i].provider_name);
        if (s && appFor(s[1])) ids.push(res.results[i].provider_id);
      }
      if (!ids.length) { done(new Error("none of the TV's streaming apps are on TMDB")); return; }
      var common = '&language=' + lang() + '&watch_region=' + REGION + '&with_watch_monetization_types=flatrate&include_adult=false'
          + '&sort_by=popularity.desc&with_watch_providers=' + encodeURIComponent(ids.join('|'))
          + (CONFIG.hideAnimation ? '&without_genres=' + ANIMATION : '');
      var hot = {movie: [], tv: []}, fresh = {movie: [], tv: []};
      each(['movie', 'tv'], function (kind, next) {
        tmdb('/trending/' + kind + '/week?language=' + lang(), function (e, r) {
          var candidates = [];
          for (var j = 0; !e && j < r.results.length && j < 16; j++) addPick(candidates, r.results[j], kind);
          // Trending is only kept when it's on one of the TV's apps: the details say where.
          each(candidates, function (p, n) {
            details(p, function (de) { if (!de && p.app) hot[kind].push(p); n(); });
          }, next);
        });
      }, function () {
        tmdb('/discover/movie?vote_count.gte=30&primary_release_date.gte=' + day(-365) + '&primary_release_date.lte=' + day(0) + common, function (e1, r1) {
          for (var j = 0; !e1 && j < r1.results.length; j++) addPick(fresh.movie, r1.results[j], 'movie');
          tmdb('/discover/tv?vote_count.gte=20&air_date.gte=' + day(-90) + '&air_date.lte=' + day(0) + common, function (e2, r2) {
            for (var k = 0; !e2 && k < r2.results.length; k++) addPick(fresh.tv, r2.results[k], 'tv');
            var list = [], seen = {};
            alternate(list, seen, hot.movie, hot.tv, 24);
            alternate(list, seen, fresh.movie, fresh.tv, 24);
            if (!list.length) { done(new Error('TMDB returned no recommendations')); return; }
            picks = list;
            done(null);
          });
        });
      });
    });
  }

  /** Fetches the list when stale (6 h, a new period of the day, language, key or apps), then this hour's details. */
  function refreshRecs() {
    if (!KEY || fetchingRecs || !installed.length) return;
    var t = Date.now(), p = hourPeriod(new Date()), st = sourceStamp();
    if (st === stamp && failedAt && t - failedAt < 10 * 60000 && t >= failedAt) return;
    var stale = st !== stamp || p !== period || t - listAt > 6 * 3600000 || t < listAt || !picks.length || listLang !== I18N.lang;
    var wanted = all(), missing = false;
    for (var i = 0; i < wanted.length; i++) missing = missing || !wanted[i].detailed;
    if (!stale && !missing) return;
    fetchingRecs = true;
    stamp = st;
    function finish(err) {
      fetchingRecs = false;
      if (err) { recsError = err.message; failedAt = Date.now(); } else { recsError = ''; failedAt = 0; }
      saveRecs();
      changed();
    }
    function detailWanted() {
      var todo = all().filter(function (x) { return !x.detailed; });
      each(todo, function (x, next) { details(x, function () { next(); }); }, function () { finish(null); });
    }
    if (stale) {
      fetchList(function (err) {
        if (err) { finish(err); return; }
        listAt = Date.now();
        period = p;
        listLang = I18N.lang;
        detailWanted();
      });
    } else {
      detailWanted();
    }
  }

  /** This hour's picks for the three tabs, without repeats (the screensaver shows them too). */
  function all() {
    var out = [], seen = {}, kinds = [null, 'movie', 'tv'];
    for (var k = 0; k < kinds.length; k++) {
      var list = now(kinds[k]);
      for (var i = 0; i < list.length; i++) if (!seen[keyOf(list[i])]) { seen[keyOf(list[i])] = true; out.push(list[i]); }
    }
    return out;
  }

  // MARK: - Browse rows and title details (the glass look's Movies and Shows tabs, spec/filmes-e-detalhes.md)

  /** TMDB genres for the rows after Popular and New, in this order; Animation is left out with hide_animation. */
  var ROW_GENRES = {movie: [28, 35, 18, 878, 16, 99, 27, 10749], tv: [10759, 35, 18, 10765, 16, 99, 80, 9648]};
  var genreNames = {movie: null, tv: null}, providerIds = {movie: null, tv: null}, rowCache = {}, titleCache = {};

  /** The TMDB ids of the services whose apps are on this TV (in this country), for one kind. */
  function ownProviders(kind, done) {
    if (providerIds[kind]) { done(null, providerIds[kind]); return; }
    tmdb('/watch/providers/' + kind + '?language=' + lang() + '&watch_region=' + REGION, function (err, res) {
      if (err) { done(err); return; }
      var ids = [];
      for (var i = 0; res.results && i < res.results.length; i++) {
        var s = service(res.results[i].provider_name);
        if (s && appFor(s[1])) ids.push(res.results[i].provider_id);
      }
      if (ids.length) providerIds[kind] = ids;
      done(ids.length ? null : new Error("none of the TV's streaming apps are on TMDB"), ids);
    });
  }

  function genresOf(kind, done) {
    if (genreNames[kind]) { done(genreNames[kind]); return; }
    tmdb('/genre/' + kind + '/list?language=' + lang(), function (err, res) {
      var map = {};
      for (var i = 0; !err && res.genres && i < res.genres.length; i++) map[res.genres[i].id] = genre(res.genres[i].name);
      if (!err) genreNames[kind] = map;
      done(map);
    });
  }

  /** The rows of a tab: [{title, query}], Popular now and New releases first, then genres. */
  function rowDefs(kind, done) {
    genresOf(kind, function (names) {
      var defs = [{title: tr('Popular now'), query: ''}];
      defs.push({title: tr('New releases'), query: kind === 'movie'
        ? '&vote_count.gte=30&primary_release_date.gte=' + day(-365) + '&primary_release_date.lte=' + day(0)
        : '&vote_count.gte=20&air_date.gte=' + day(-90) + '&air_date.lte=' + day(0)});
      var ids = ROW_GENRES[kind];
      for (var i = 0; i < ids.length; i++) {
        if (ids[i] === ANIMATION && CONFIG.hideAnimation) continue;
        if (names[ids[i]]) defs.push({title: names[ids[i]], query: '&with_genres=' + ids[i]});
      }
      done(defs);
    });
  }

  function year(o) { return ((o.release_date || o.first_air_date || '') + '').slice(0, 4); }

  /** A row item from TMDB's list result: enough for the thumbnail and the featured slide (no request per title). */
  function rowItem(o, kind, names) {
    var parts = [kind === 'tv' ? tr('Series') : tr('Movie')];
    if (o.genre_ids && o.genre_ids.length && names && names[o.genre_ids[0]]) parts.push(names[o.genre_ids[0]]);
    if (year(o)) parts.push(year(o));
    return {id: o.id, kind: kind, title: kind === 'movie' ? o.title : o.name, backdrop: o.backdrop_path,
      overview: o.overview || '', vote: o.vote_average || 0, meta: parts.join(' · ')};
  }

  /** Row i of a tab ({title, items}), only titles on the TV's apps; done(null) when there are no more rows. */
  function browseRow(kind, i, done) {
    var key = kind + ':' + i + ':' + I18N.lang, hit = rowCache[key];
    if (hit && Date.now() - hit.at < 6 * 3600000) { done(hit.row); return; }
    rowDefs(kind, function (defs) {
      if (i >= defs.length) { done(null); return; }
      ownProviders(kind, function (err, ids) {
        if (err) { done({title: defs[i].title, items: []}); return; }
        tmdb('/discover/' + kind + '?language=' + lang() + '&watch_region=' + REGION + '&with_watch_monetization_types=flatrate'
            + '&include_adult=false&sort_by=popularity.desc&with_watch_providers=' + encodeURIComponent(ids.join('|'))
            + (CONFIG.hideAnimation ? '&without_genres=' + ANIMATION : '') + defs[i].query, function (e, res) {
          var items = [], names = genreNames[kind];
          for (var j = 0; !e && res.results && j < res.results.length; j++) {
            if (res.results[j].backdrop_path) items.push(rowItem(res.results[j], kind, names));
          }
          var row = {title: defs[i].title, items: items};
          if (!e) rowCache[key] = {row: row, at: Date.now()};
          done(row);
        });
      });
    });
  }

  /** Brazil's (the region's) age rating, when TMDB has one. */
  function certification(o, kind) {
    var list = kind === 'movie' ? o.release_dates && o.release_dates.results : o.content_ratings && o.content_ratings.results;
    for (var i = 0; list && i < list.length; i++) {
      if (list[i].iso_3166_1 !== REGION) continue;
      if (kind === 'tv') return list[i].rating || '';
      for (var j = 0; list[i].release_dates && j < list[i].release_dates.length; j++) {
        if (list[i].release_dates[j].certification) return list[i].release_dates[j].certification;
      }
    }
    return '';
  }

  /** Everything the details screen shows; done(err, t). Kept for the session, so reopening a title is instant. */
  function titleDetails(kind, id, done) {
    var key = kind + ':' + id + ':' + I18N.lang;
    if (titleCache[key]) { done(null, titleCache[key]); return; }
    tmdb('/' + kind + '/' + id + '?language=' + lang() + '&append_to_response=watch/providers,credits,recommendations,images,'
        + (kind === 'movie' ? 'release_dates' : 'content_ratings') + '&include_image_language=null,' + I18N.base + ',en', function (err, o) {
      if (err) { done(err); return; }
      var t = {id: id, kind: kind, title: kind === 'movie' ? o.title : o.name, overview: o.overview || '', year: year(o),
        vote: o.vote_average || 0, backdrop: bestBackdrop(o.images) || o.backdrop_path, cert: certification(o, kind),
        genres: (o.genres || []).slice(0, 2).map(function (g) { return genre(g.name); }), by: [], cast: [], where: [], more: [],
        app: null, service: ''};
      if (kind === 'movie') {
        if (o.runtime > 0) t.length = o.runtime;
        var crew = (o.credits && o.credits.crew) || [];
        for (var c = 0; c < crew.length && t.by.length < 2; c++) if (crew[c].job === 'Director') t.by.push(crew[c].name);
      } else {
        t.seasons = o.number_of_seasons || 0;
        for (var b = 0; o.created_by && b < o.created_by.length && t.by.length < 2; b++) t.by.push(o.created_by[b].name);
      }
      var cast = (o.credits && o.credits.cast) || [];
      for (var k = 0; k < cast.length && t.cast.length < 8; k++) {
        t.cast.push({name: cast[k].name, role: cast[k].character || '', photo: cast[k].profile_path || ''});
      }
      // Where to watch here: each service once, its kind (subscription, rent, buy) and whether its app is on the TV.
      var wp = o['watch/providers'], here = wp && wp.results && wp.results[REGION], seen = {}, kinds = ['flatrate', 'rent', 'buy'];
      for (var w = 0; here && w < kinds.length; w++) {
        var list = here[kinds[w]] || [];
        for (var q = 0; q < list.length; q++) {
          var name = list[q].provider_name, s = service(name);
          if (seen[name]) continue;
          seen[name] = true;
          var app = s ? appFor(s[1]) : null;
          t.where.push({name: s ? s[4] : name, how: kinds[w], installed: !!app});
          if (!t.app && app && kinds[w] === 'flatrate') { t.app = s[1]; t.service = s[4]; }
        }
      }
      var recs = (o.recommendations && o.recommendations.results) || [];
      for (var r = 0; r < recs.length && t.more.length < 12; r++) {
        if (recs[r].backdrop_path) t.more.push(rowItem(recs[r], recs[r].media_type === 'movie' || recs[r].media_type === 'tv' ? recs[r].media_type : kind, null));
      }
      titleCache[key] = t;
      done(null, t);
    });
  }

  // MARK: - Stremio catalogs (the glass look's Stremio tab, spec/stremio.md): catalogs and metadata only, never streams

  var ADDONS = CONFIG.stremioAddons && CONFIG.stremioAddons.length ? CONFIG.stremioAddons : ['https://v3-cinemeta.strem.io/manifest.json'];
  var addonDefs = null, addonDefsWaiting = null, addonRows = {};

  function addonBase(url) { return url.replace(/\/manifest\.json(\?.*)?$/, ''); }
  function addonKind(type) { return type === 'series' ? 'tv' : type === 'movie' ? 'movie' : type; }
  function addonGet(url, done) { get(url, {Accept: 'application/json'}, done); }

  /** The rows of the Stremio tab, from the addons' manifests: [{base, type, id, extra, title}], up to 12. */
  function stremioDefs(done) {
    if (addonDefs) { done(addonDefs); return; }
    if (addonDefsWaiting) { addonDefsWaiting.push(done); return; }
    addonDefsWaiting = [done];
    var defs = [];
    each(ADDONS, function (url, next) {
      addonGet(url, function (err, m) {
        var cats = (!err && m && m.catalogs) || [];
        for (var i = 0; i < cats.length && defs.length < 12; i++) {
          var c = cats[i], required = (c.extraRequired || []).slice(), options = c.genres || [];
          for (var x = 0; c.extra && x < c.extra.length; x++) {
            var e = c.extra[x];
            if (e && e.isRequired) required.push(e.name);
            if (e && e.name === 'genre' && e.options) options = e.options;
          }
          var extra = '';
          if (required.length) {
            if (required.length > 1 || required[0] !== 'genre' || !options.length) continue;
            // A genre it can't do without (Cinemeta's New is by year): the newest year, or else the first option.
            var pick = options[0];
            for (var o = 0; o < options.length; o++) if (/^\d{4}$/.test(options[o]) && options[o] > pick) pick = options[o];
            extra = 'genre=' + encodeURIComponent(pick);
          }
          var kind = addonKind(c.type);
          defs.push({base: addonBase(url), type: c.type, id: c.id, extra: extra,
            title: (c.name || c.id) + ' · ' + (kind === 'movie' ? tr('Movies') : kind === 'tv' ? tr('Shows') : c.type.charAt(0).toUpperCase() + c.type.slice(1))});
        }
        next();
      });
    }, function () {
      addonDefs = defs;
      var waiting = addonDefsWaiting;
      addonDefsWaiting = null;
      for (var w = 0; w < waiting.length; w++) waiting[w](defs);
    });
  }

  function addonItem(m, base) {
    var kind = addonKind(m.type), genres = m.genres || m.genre || [];
    var parts = [kind === 'tv' ? tr('Series') : kind === 'movie' ? tr('Movie') : (m.type || '').charAt(0).toUpperCase() + (m.type || '').slice(1)];
    if (genres.length) parts.push(genres[0]);
    if (m.releaseInfo || m.year) parts.push(m.releaseInfo || m.year);
    return {id: m.moviedb_id || m.id, sid: m.id, src: 'stremio', base: base, stype: m.type, kind: kind,
      tmdb: m.moviedb_id || 0, title: m.name || '', img: m.background || m.poster || '', overview: m.description || '',
      vote: parseFloat(m.imdbRating) || 0, meta: parts.join(' · ')};
  }

  /** Row i of the Stremio tab ({title, items}); done(null) when there are no more rows. */
  function stremioRow(i, done) {
    var hit = addonRows[i];
    if (hit && Date.now() - hit.at < 3 * 3600000) { done(hit.row); return; }
    stremioDefs(function (defs) {
      var d = defs[i];
      if (!d) { done(null); return; }
      addonGet(d.base + '/catalog/' + d.type + '/' + encodeURIComponent(d.id) + (d.extra ? '/' + d.extra : '') + '.json', function (err, res) {
        var items = [];
        for (var j = 0; !err && res && res.metas && j < res.metas.length && items.length < 30; j++) {
          if (res.metas[j].id && (res.metas[j].background || res.metas[j].poster)) items.push(addonItem(res.metas[j], d.base));
        }
        var row = {title: d.title, items: items};
        if (!err) addonRows[i] = {row: row, at: Date.now()};
        done(row);
      });
    });
  }

  /** A Stremio title's details: TMDB's when it maps to one (moviedb_id, or an IMDb id TMDB finds), else the addon's. */
  function stremioTitle(item, done) {
    if ((item.kind === 'movie' || item.kind === 'tv') && KEY) {
      if (item.tmdb) { titleDetails(item.kind, item.tmdb, function (e, t) { if (e) addonTitle(item, done); else done(null, t); }); return; }
      if (/^tt\d+$/.test(item.sid || '')) {
        tmdb('/find/' + item.sid + '?external_source=imdb_id', function (e, r) {
          var list = !e && r && (item.kind === 'movie' ? r.movie_results : r.tv_results);
          if (list && list.length) titleDetails(item.kind, list[0].id, function (e2, t) { if (e2) addonTitle(item, done); else done(null, t); });
          else addonTitle(item, done);
        });
        return;
      }
    }
    addonTitle(item, done);
  }

  function addonTitle(item, done) {
    if (!item.base) { done(new Error('no addon')); return; }
    addonGet(item.base + '/meta/' + item.stype + '/' + encodeURIComponent(item.sid) + '.json', function (err, r) {
      var m = (!err && r && r.meta) || {}, names = function (list) { return (list || []).map(function (x) { return typeof x === 'string' ? x : x && x.name; }).filter(function (x) { return x; }); };
      done(null, {id: item.sid, kind: item.kind, title: m.name || item.title, overview: m.description || item.overview,
        year: ((m.releaseInfo || m.year || '') + '').slice(0, 9), vote: parseFloat(m.imdbRating) || item.vote, voteBy: 'IMDb',
        img: m.background || item.img, cert: '', genres: (m.genres || m.genre || []).slice(0, 2), by: names(m.director).slice(0, 2),
        cast: names(m.cast).slice(0, 6).map(function (n) { return {name: n, role: '', photo: ''}; }), where: [], more: [], app: null, service: ''});
    });
  }

  // MARK: - Formatting

  function fmt(v, digits) {
    try { return v.toLocaleString(I18N.locale(), {minimumFractionDigits: digits, maximumFractionDigits: digits}); } catch (e) { return v.toFixed(digits); }
  }

  var SYMBOLS = {USD: '$', BRL: 'R$ ', EUR: '€', GBP: '£', JPY: '¥'};

  return {
    COINS: COINS,
    city: Place.city,
    currency: CURRENCY,
    onChange: function (fn) { listeners.push(fn); },
    setApps: function (apps) { installed = apps; },
    appFor: appFor,
    refresh: function () { refreshWeather(); refreshPrices(); refreshRecs(); },
    settingsChanged: function () { pricesAt = 0; refreshPrices(); changed(); },
    get weather() { return weather; },
    get weatherAt() { return weatherAt; },
    prices: prices,
    changes: changes,
    get pricesAt() { return pricesAt; },
    activeCoins: activeCoins,
    hasKey: function () { return !!KEY; },
    recsError: function () { return recsError; },
    picks: now,
    showcase: all,
    browseRow: browseRow,
    stremioRow: stremioRow,
    stremioTitle: stremioTitle,
    title: titleDetails,
    /** "7,8": TMDB's score with one decimal, in the TV's language. */
    rating: function (v) { return v ? fmt(v, 1) : ''; },
    image: function (path, size) { return path ? 'https://image.tmdb.org/t/p/' + (size || 'w1280') + path : ''; },

    /** Night at the location: from sunset to sunrise (the last forecast; without one, 6:00 and 18:00). */
    isNight: function (at) {
      var theme = Prefs.theme();
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      var d = new Date(at), mins = d.getHours() * 60 + d.getMinutes();
      function hm(t, fallback) { if (!t) return fallback; var x = new Date(t); return x.getHours() * 60 + x.getMinutes(); }
      var rise = hm(weather && weather.sunrise, 360), set = hm(weather && weather.sunset, 1080);
      return mins < rise || mins >= set;
    },

    compact: function (v) {
      if (isNaN(v)) return '—';
      if (v >= 10000) return fmt(v / 1000, 1) + 'k';
      if (v >= 1000) return fmt(v / 1000, 2) + 'k';
      if (v >= 100) return fmt(v, 0);
      return fmt(v, 2);
    },
    money: function (v) {
      var s = SYMBOLS[CURRENCY] || CURRENCY + ' ';
      if (isNaN(v)) return s + '—';
      return s + (v >= 1000 ? fmt(v, 0) : fmt(v, 2));
    },
    change: function (v) { return isNaN(v) ? '' : (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 1) + '%'; },
    degrees: function (v) {
      if (v === undefined || v === null || isNaN(v)) return '—';
      var unit = Prefs.temperature();
      var f = unit === 'F' || (unit === 'auto' && Place.fahrenheit);
      return Math.round(f ? v * 9 / 5 + 32 : v) + '°';
    },
    /** "3 PM", "15:00", "15 Uhr": the hourly forecast. */
    hour: function (at) { return formatDate('format|h a', at); },
    /** "5:21 AM", "05:21": the clock, sunrise and sunset. */
    time: function (at) { return formatDate('format|h:mm a', at); },
    /** "12 min ago" when the data is old (no internet), or empty. */
    staleness: function (at, every) {
      if (!at) return '';
      var age = Date.now() - at;
      if (age < every * 2) return '';
      var m = Math.floor(age / 60000), h = Math.floor(m / 60);
      return m < 60 ? trf('{n} min ago', {n: m}) : trf('{n} h ago', {n: h});
    },
    condition: function (code, day) {
      if (code === undefined || code === null || code < 0) return '';
      if (code === 0) return day ? tr('Clear') : tr('night|Clear');
      if (code === 1) return day ? tr('Mostly Sunny') : tr('Mostly Clear');
      if (code === 2) return tr('Partly Cloudy');
      if (code === 3) return tr('Cloudy');
      if (code === 45 || code === 48) return tr('Fog');
      if (code >= 51 && code <= 57) return tr('Drizzle');
      if (code === 65 || code === 67 || code === 82) return tr('Heavy Rain');
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return tr('Snow');
      if (code >= 95) return tr('Thunderstorms');
      return tr('Rain');
    },
    symbol: function (code, day) {
      if (code <= 1) return day ? 'sunny' : 'clear_night';
      if (code === 2) return day ? 'partly_cloudy_day' : 'partly_cloudy_night';
      if (code === 3) return 'cloud';
      if (code === 45 || code === 48) return 'foggy';
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowflake';
      if (code >= 95) return 'thunderstorm';
      return 'rainy';
    },
    coinName: function (i) { return i === 3 ? tr('Dollar') : ['Bitcoin', 'Ethereum', 'Solana'][i]; }
  };
})();
