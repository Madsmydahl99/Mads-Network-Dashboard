/* Mads Network Dashboard v2 — NETWORK
 * Compact native network summary using $network + Surge local GeoIP/ASN databases.
 * External request: api.ipify.org only, to learn the current public IPv4.
 */
(function () {
  var net = (typeof $network !== 'undefined' && $network) ? $network : {};
  var wifi = net.wifi || {};
  var cell = net['cellular-data'] || {};
  var v4 = net.v4 || {};
  var v6 = net.v6 || {};
  var CACHE_KEY = 'MadsDash.Network.PublicInfo.v2';

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

  function localSummary(country) {
    var out = [];
    var countryText = country ? ((flag(country) ? flag(country) + ' ' : '') + country) : '';

    if (wifi.ssid) {
      out.push('Wi-Fi · ' + wifi.ssid + (countryText ? ' · ' + countryText : ''));
      if (v4.primaryAddress || v4.primaryRouter) {
        var lan = v4.primaryAddress ? 'LAN ' + v4.primaryAddress : 'LAN unavailable';
        var gw = v4.primaryRouter ? 'GW ' + v4.primaryRouter : 'GW unavailable';
        out.push(lan + '  →  ' + gw);
      }
    } else if (cell.radio || cell.carrier) {
      var first = radioName(cell.radio);
      if (cell.carrier) first += ' · ' + cell.carrier;
      if (countryText) first += ' · ' + countryText;
      out.push(first);
      if (v4.primaryAddress) out.push('Local ' + v4.primaryAddress + (v4.primaryInterface ? ' · ' + v4.primaryInterface : ''));
    } else {
      out.push('Network unavailable' + (countryText ? ' · ' + countryText : ''));
      if (v4.primaryAddress) out.push('Local ' + v4.primaryAddress);
    }
    return out;
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
    var lines = localSummary(info.country);

    if (info.ip) lines.push('WAN ' + info.ip + (isCached ? ' · cached' : ''));
    else lines.push('WAN unavailable');

    var orgBits = [];
    if (info.aso) orgBits.push(info.aso);
    if (info.asn) orgBits.push('AS' + String(info.asn).replace(/^AS/i, ''));
    if (orgBits.length) lines.push(orgBits.join(' · '));

    var ipv6Text = v6.primaryAddress ? 'IPv6 ' + v6.primaryAddress : 'IPv6 Off';
    lines.push(ipv6Text + ' · Policy ' + selectedPolicy());

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
    headers: { 'User-Agent': 'Surge-MadsDash/2.0' }
  }, function (error, response, data) {
    var ip = String(data || '').trim();
    var validIPv4 = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(ip);

    if (!error && response && response.status >= 200 && response.status < 300 && validIPv4) {
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
