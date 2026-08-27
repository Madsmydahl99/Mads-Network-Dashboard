/* Mads Network Dashboard v2 — DNS
 * Reads Surge's local DNS API. Manual panel refresh is the ONLY path that flushes.
 * Important: snapshot + latency are collected BEFORE the flush so useful resolver info
 * is not destroyed before it can be displayed.
 */
(function () {
  var LAST_RESOLVERS_KEY = 'MadsDash.DNS.LastResolvers.v2';
  var manual = (typeof $trigger !== 'undefined' && $trigger === 'button');

  function api(method, path, body) {
    return new Promise(function (resolve) {
      $httpAPI(method, path, body || null, function (result) { resolve(result || {}); });
    });
  }

  function friendlyServer(value) {
    var s = String(value || '').trim();
    var low = s.toLowerCase();
    if (!s) return '';
    if (low.indexOf('cloudflare') >= 0 || low.indexOf('1.1.1.1') >= 0) return 'Cloudflare';
    if (low.indexOf('dns.google') >= 0 || low.indexOf('8.8.8.8') >= 0 || low.indexOf('8.8.4.4') >= 0) return 'Google';
    if (low === 'system') return 'System';
    if (s.length > 34) {
      try {
        var m = s.match(/^https?:\/\/([^\/]+)/i);
        if (m && m[1]) return m[1];
      } catch (e) {}
      return s.slice(0, 31) + '…';
    }
    return s;
  }

  function uniqueServers(cache) {
    var out = [];
    (cache || []).forEach(function (entry) {
      var value = friendlyServer(entry && entry.server);
      if (value && out.indexOf(value) < 0) out.push(value);
    });
    return out;
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

  function compactList(list, max) {
    list = list || [];
    if (!list.length) return '';
    if (list.length <= max) return list.join(' / ');
    return list.slice(0, max).join(' / ') + ' +' + (list.length - max);
  }

  function networkDnsText() {
    var dns = ($network && Array.isArray($network.dns)) ? $network.dns.filter(Boolean) : [];
    return dns.length ? compactList(dns, 2) : 'unavailable';
  }

  Promise.all([
    api('GET', '/v1/dns'),
    api('POST', '/v1/test/dns_delay')
  ]).then(function (values) {
    var dns = values[0] || {};
    var delayResult = values[1] || {};
    var cache = dns.dnsCache || dns.cache || [];
    var cacheCount = Array.isArray(cache) ? cache.length : 0;
    var servers = uniqueServers(cache);
    if (servers.length) saveResolvers(servers);
    var remembered = servers.length ? servers : loadResolvers();

    var delay = Number(delayResult.delay);
    var delayMs = isFinite(delay) ? Math.round(delay * 1000) : null;
    var delayText = delayMs === null ? 'DNS delay unavailable' : 'DNS delay ' + delayMs + 'ms';
    var upstreamText = remembered.length ? compactList(remembered, 2) : 'No upstream observed yet';

    function finish(flushed) {
      var content;
      if (flushed) {
        content = 'Flushed ' + cacheCount + ' cached lookup' + (cacheCount === 1 ? '' : 's') + '\n' +
                  'Upstream ' + upstreamText + '\n' +
                  delayText + '\n' +
                  'Network DNS ' + networkDnsText();
      } else {
        content = 'Cache ' + cacheCount + ' · ' + upstreamText + '\n' +
                  delayText + '\n' +
                  'Network DNS ' + networkDnsText() + '\n' +
                  '↻ Refresh = flush cache';
      }

      var color = '#497C64';
      if (delayMs === null) color = '#9A7647';
      else if (delayMs > 200) color = '#B85C5C';
      else if (delayMs > 80) color = '#9A7647';
      if (flushed) color = '#4A789C';

      $done({
        title: 'DNS',
        content: content,
        icon: 'arrow.clockwise',
        'icon-color': color
      });
    }

    if (!manual) {
      finish(false);
      return;
    }

    api('POST', '/v1/dns/flush').then(function () { finish(true); });
  }).catch(function (e) {
    $done({
      title: 'DNS',
      content: 'DNS status unavailable\n' + String(e || '') + '\n↻ Refresh = flush cache',
      icon: 'exclamationmark.circle',
      'icon-color': '#B85C5C'
    });
  });
})();
