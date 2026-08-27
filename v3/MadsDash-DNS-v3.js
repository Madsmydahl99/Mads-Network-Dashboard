/* Mads Network Dashboard v3 — DNS
 * Reads cache/resolver details before any action. A panel-button refresh is the
 * only path that flushes; automatic evaluations remain read-only.
 */
(function () {
  var LAST_RESOLVERS_KEY = 'MadsDash.DNS.LastResolvers.v3';
  var manual = (typeof $trigger !== 'undefined' && $trigger === 'button');

  function api(method, path, body) {
    return new Promise(function (resolve) {
      $httpAPI(method, path, body || null, function (result) { resolve(result || {}); });
    });
  }

  function friendlyServer(value) {
    var server = String(value || '').trim();
    var low = server.toLowerCase();
    if (!server) return '';
    if (low.indexOf('cloudflare') >= 0 || low.indexOf('1.1.1.1') >= 0) return 'Cloudflare';
    if (low.indexOf('dns.google') >= 0 || low.indexOf('8.8.8.8') >= 0 || low.indexOf('8.8.4.4') >= 0) return 'Google';
    if (low.indexOf('quad9') >= 0 || low.indexOf('9.9.9.9') >= 0) return 'Quad9';
    if (low === 'system') return 'System';
    try {
      var match = server.match(/^https?:\/\/([^/]+)/i);
      if (match && match[1]) return match[1];
    } catch (e) {}
    return server.length > 30 ? server.slice(0, 27) + '…' : server;
  }

  function uniqueResolvers(cache) {
    var output = [];
    (cache || []).forEach(function (entry) {
      var value = friendlyServer(entry && entry.server);
      if (value && output.indexOf(value) < 0) output.push(value);
    });
    return output;
  }

  function saveResolvers(list) {
    if (!list || !list.length) return;
    try { $persistentStore.write(JSON.stringify(list), LAST_RESOLVERS_KEY); } catch (e) {}
  }

  function loadResolvers() {
    try {
      var raw = $persistentStore.read(LAST_RESOLVERS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function compact(list, maximum) {
    list = list || [];
    if (!list.length) return 'not observed yet';
    if (list.length <= maximum) return list.join(' · ');
    return list.slice(0, maximum).join(' · ') + ' · +' + (list.length - maximum);
  }

  function networkDns() {
    var list = (typeof $network !== 'undefined' && $network && Array.isArray($network.dns))
      ? $network.dns.filter(Boolean)
      : [];
    return list.length ? compact(list, 2) : 'unavailable';
  }

  function quality(delayMs) {
    if (delayMs === null) return 'unavailable';
    if (delayMs <= 40) return delayMs + 'ms · fast';
    if (delayMs <= 100) return delayMs + 'ms · normal';
    return delayMs + 'ms · slow';
  }

  Promise.all([
    api('GET', '/v1/dns'),
    api('POST', '/v1/test/dns_delay')
  ]).then(function (values) {
    var dns = values[0] || {};
    var delayResult = values[1] || {};
    var cache = dns.dnsCache || dns.cache || [];
    var cacheCount = Array.isArray(cache) ? cache.length : 0;
    var resolvers = uniqueResolvers(cache);
    if (resolvers.length) saveResolvers(resolvers);
    if (!resolvers.length) resolvers = loadResolvers();

    var rawDelay = Number(delayResult.delay);
    var delayMs = isFinite(rawDelay) ? Math.round(rawDelay * 1000) : null;

    function finish(flushed) {
      var first = flushed
        ? 'Cleared ' + cacheCount + ' cached DNS entr' + (cacheCount === 1 ? 'y' : 'ies')
        : 'Cache ' + cacheCount + ' entries · refresh clears';
      var content = first + '\n' +
                    'Resolvers ' + compact(resolvers, 2) + '\n' +
                    'Lookup ' + quality(delayMs) + '\n' +
                    'Network-provided ' + networkDns();

      var color = '#497C64';
      if (delayMs === null || delayMs > 100) color = '#9A7647';
      if (delayMs !== null && delayMs > 250) color = '#B85C5C';
      if (flushed) color = '#4A789C';

      $done({
        title: 'DNS',
        content: content,
        icon: flushed ? 'checkmark.circle' : 'arrow.clockwise',
        'icon-color': color
      });
    }

    if (!manual) {
      finish(false);
      return;
    }

    api('POST', '/v1/dns/flush').then(function () { finish(true); });
  }).catch(function (error) {
    $done({
      title: 'DNS',
      content: 'DNS status unavailable\n' + String(error || '') + '\nRefresh would flush only when available',
      icon: 'exclamationmark.circle',
      'icon-color': '#B85C5C'
    });
  });
})();
