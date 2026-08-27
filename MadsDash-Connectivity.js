/* Mads Network Dashboard v2 — CONNECTIVITY
 * Four concurrent lightweight reachability checks. Every service shows latency.
 * Any legitimate HTTP response means reachable; transport/DNS/TLS/timeout errors mean failure.
 */
(function () {
  var targets = [
    { key: 'Cloudflare', url: 'https://cp.cloudflare.com/generate_204' },
    { key: 'Apple', url: 'https://captive.apple.com/hotspot-detect.html' },
    { key: 'GitHub', url: 'https://api.github.com/' },
    { key: 'OpenAI', url: 'https://api.openai.com/v1/models' }
  ];

  function check(t, done) {
    var started = Date.now();
    $httpClient.head({
      url: t.url,
      timeout: 5,
      'auto-cookie': false,
      'auto-redirect': false,
      headers: { 'User-Agent': 'Surge-MadsDash/2.0' }
    }, function (error, response) {
      var status = response ? Number(response.status || response.statusCode || 0) : 0;
      var reachable = !error && status > 0;
      var portalHint = (t.key === 'Cloudflare' || t.key === 'Apple') && status >= 300 && status < 400;
      done({
        key: t.key,
        reachable: reachable,
        ms: Date.now() - started,
        status: status,
        error: error ? String(error) : '',
        portalHint: portalHint
      });
    });
  }

  function serviceText(r) {
    if (!r || !r.reachable) return r && r.key ? r.key + ' ✕' : 'Unknown ✕';
    if (r.portalHint) return r.key + ' ' + r.ms + 'ms ?';
    return r.key + ' ' + r.ms + 'ms ✓';
  }

  var pending = targets.length;
  var results = {};
  targets.forEach(function (target) {
    check(target, function (result) {
      results[result.key] = result;
      pending -= 1;
      if (pending) return;

      var ordered = targets.map(function (t) { return results[t.key]; });
      var online = ordered.filter(function (r) { return r && r.reachable; });
      var failures = ordered.length - online.length;
      var avg = online.length ? Math.round(online.reduce(function (sum, r) { return sum + r.ms; }, 0) / online.length) : null;
      var worst = online.length ? Math.max.apply(null, online.map(function (r) { return r.ms; })) : Infinity;
      var portal = ordered.some(function (r) { return r && r.portalHint; });

      var icon = 'checkmark.circle';
      var color = '#497C64';
      if (failures >= 2) { icon = 'xmark.circle'; color = '#B85C5C'; }
      else if (failures === 1 || portal || worst > 350) { icon = 'exclamationmark.triangle'; color = '#9A7647'; }

      var summary = online.length + '/4 online';
      if (avg !== null) summary += ' · avg ' + avg + 'ms';
      if (portal) summary += ' · captive portal?';

      $done({
        title: 'CONNECTIVITY',
        content: serviceText(results.Cloudflare) + '\n' +
                 serviceText(results.Apple) + '\n' +
                 serviceText(results.GitHub) + '\n' +
                 serviceText(results.OpenAI) + '\n' + summary,
        icon: icon,
        'icon-color': color
      });
    });
  });
})();
