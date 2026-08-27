/* Mads Network Dashboard v3 — NETWORK
 * Compact local network and public-exit summary.
 * A network-change event clears the previous network's cached WAN identity.
 * External request: api.ipify.org only, to learn the current public IPv4.
 */
(function () {
  var CACHE_KEY = 'MadsDash.Network.PublicInfo.v3';

  if (typeof $event !== 'undefined' && $event && $event.name === 'network-changed') {
    try { $persistentStore.write('', CACHE_KEY); } catch (e) {}
    $done();
    return;
  }

  var net = (typeof $network !== 'undefined' && $network) ? $network : {};
  var wifi = net.wifi || {};
  var cell = net['cellular-data'] || {};
  var v4 = net.v4 || {};
  var v6 = net.v6 || {};

  function radioName(radio) {
    var names = {
      NR: '5G', NRNSA: '5G', LTE: 'LTE', WCDMA: '3G', HSDPA: '3G',
      HSUPA: '3G', EDGE: '2G', GPRS: '2G'
    };
    return names[radio] || radio || 'Cellular';
  }

  function flag(code) {
    code = String(code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || typeof String.fromCodePoint !== 'function') return '';
    return String.fromCodePoint(code.charCodeAt(0) + 127397, code.charCodeAt(1) + 127397);
  }

  function selectedPolicy() {
    try {
      var details = $surge.selectGroupDetails();
      var selected = details && details.decisions && details.decisions['DIRECT-SELECT'];
      return selected || 'Unavailable';
    } catch (e) {
      return 'Unavailable';
    }
  }

  function accessLine(country) {
    var countryText = country ? ((flag(country) ? flag(country) + ' ' : '') + country) : '';
    var parts = [];
    if (wifi.ssid) {
      parts.push('Wi-Fi', wifi.ssid);
    } else if (cell.radio || cell.carrier) {
      parts.push(radioName(cell.radio));
      if (cell.carrier) parts.push(cell.carrier);
    } else {
      parts.push('Network unavailable');
    }
    if (countryText) parts.push(countryText);
    return parts.join(' · ');
  }

  function cachedInfo() {
    try {
      var raw = $persistentStore.read(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveInfo(info) {
    try { $persistentStore.write(JSON.stringify(info), CACHE_KEY); } catch (e) {}
  }

  function render(info, isCached) {
    info = info || {};
    var lines = [accessLine(info.country)];

    if (v4.primaryAddress || v4.primaryRouter) {
      lines.push((v4.primaryAddress ? 'LAN ' + v4.primaryAddress : 'LAN —') +
                 '  →  ' + (v4.primaryRouter ? 'GW ' + v4.primaryRouter : 'GW —'));
    }

    lines.push(info.ip ? 'Public ' + info.ip + (isCached ? ' · cached' : '') : 'Public IP unavailable');

    var provider = [];
    if (info.aso) provider.push(info.aso);
    if (info.asn) provider.push('AS' + String(info.asn).replace(/^AS/i, ''));
    if (provider.length) lines.push(provider.join(' · '));

    lines.push((v6.primaryAddress ? 'IPv6 On' : 'IPv6 Off') + ' · Route ' + selectedPolicy());

    $done({
      title: 'NETWORK',
      content: lines.join('\n'),
      icon: wifi.ssid ? 'wifi' : 'antenna.radiowaves.left.and.right',
      'icon-color': info.ip ? '#4A789C' : '#9A7647'
    });
  }

  $httpClient.get({
    url: 'https://api.ipify.org/',
    timeout: 5,
    'auto-cookie': false,
    'auto-redirect': false,
    headers: { 'User-Agent': 'Surge-MadsDash/3.0', 'Cache-Control': 'no-cache' }
  }, function (error, response, data) {
    var ip = String(data || '').trim();
    var status = response ? Number(response.status || response.statusCode || 0) : 0;
    var validIPv4 = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(ip);

    if (!error && status >= 200 && status < 300 && validIPv4) {
      var info = { ip: ip, country: '', asn: '', aso: '', at: Date.now() };
      try {
        info.country = $utils.geoip(ip) || '';
        info.asn = $utils.ipasn(ip) || '';
        info.aso = $utils.ipaso(ip) || '';
      } catch (e) {}
      saveInfo(info);
      render(info, false);
      return;
    }

    var cache = cachedInfo();
    render(cache || {}, !!cache);
  });
})();
