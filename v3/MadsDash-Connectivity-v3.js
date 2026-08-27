/* Mads Network Dashboard v3 — CONNECTIVITY
 * Small end-to-end HTTP checks. Times include DNS, connection setup, TLS and
 * server response; they are deliberately labelled as web RTT, not ICMP ping.
 */
(function () {
  var targets = [
    { key: 'Internet/CF', url: 'https://cp.cloudflare.com/generate_204', canary: 'cloudflare' },
    { key: 'Apple login', url: 'https://captive.apple.com/hotspot-detect.html', canary: 'apple' },
    { key: 'GitHub API', url: 'https://api.github.com/' },
    { key: 'OpenAI API', url: 'https://api.openai.com/v1/models' }
  ];

  function check(target, done) {
    var started = Date.now();
    $httpClient.get({
      url: target.url,
      timeout: 6,
      'auto-cookie': false,
      'auto-redirect': false,
      headers: { 'User-Agent': 'Surge-MadsDash/3.0', 'Cache-Control': 'no-cache' }
    }, function (error, response, data) {
      var status = response ? Number(response.status || response.statusCode || 0) : 0;
      var transportOk = !error && status > 0;
      var portalHint = false;

      if (target.canary === 'cloudflare' && transportOk) portalHint = status !== 204;
      if (target.canary === 'apple' && transportOk) {
        portalHint = status !== 200 || String(data || '').toLowerCase().indexOf('success') < 0;
      }

      done({
        key: target.key,
        reachable: transportOk,
        portalHint: portalHint,
        ms: Date.now() - started,
        status: status,
        error: error ? String(error) : ''
      });
    });
  }

  function row(result) {
    if (!result || !result.reachable) return (result ? result.key : 'Unknown') + ' — ✕';
    if (result.portalHint) return result.key + ' ' + result.ms + 'ms · portal?';
    return result.key + ' ' + result.ms + 'ms ✓';
  }

  var pending = targets.length;
  var results = {};

  targets.forEach(function (target) {
    check(target, function (result) {
      results[result.key] = result;
      pending -= 1;
      if (pending) return;

      var ordered = targets.map(function (item) { return results[item.key]; });
      var online = ordered.filter(function (item) { return item && item.reachable; });
      var failures = ordered.length - online.length;
      var portal = ordered.some(function (item) { return item && item.portalHint; });
      var avg = online.length ? Math.round(online.reduce(function (sum, item) {
        return sum + item.ms;
      }, 0) / online.length) : null;

      var icon = 'checkmark.circle';
      var color = '#497C64';
      if (failures >= 2) {
        icon = 'xmark.circle';
        color = '#B85C5C';
      } else if (failures === 1 || portal || (avg !== null && avg > 350)) {
        icon = 'exclamationmark.triangle';
        color = '#9A7647';
      }

      var summary = online.length + '/4 reachable';
      if (avg !== null) summary += ' · avg ' + avg + 'ms';
      if (portal) summary += ' · check Wi-Fi login';

      $done({
        title: 'CONNECTIVITY',
        content: 'Web RTT · includes DNS/TLS · lower is better\n' +
                 row(results['Internet/CF']) + '\n' +
                 row(results['Apple login']) + '\n' +
                 row(results['GitHub API']) + '\n' +
                 row(results['OpenAI API']) + '\n' + summary,
        icon: icon,
        'icon-color': color
      });
    });
  });
})();
