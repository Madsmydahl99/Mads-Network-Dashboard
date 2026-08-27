/* Mads Network Dashboard v3 — LIVE TRAFFIC
 * Local-only interface telemetry from Surge's /v1/traffic API.
 * Automatic evaluations preserve the selected interface; a manual panel refresh
 * cycles through the available interfaces without changing network settings.
 */
(function () {
  var SELECTED_KEY = 'MadsDash.Traffic.SelectedInterface.v3';
  var manual = (typeof $trigger !== 'undefined' && $trigger === 'button');

  function api(path) {
    return new Promise(function (resolve) {
      $httpAPI('GET', path, null, function (result) { resolve(result || {}); });
    });
  }

  function number(value) {
    value = Number(value);
    return isFinite(value) && value > 0 ? value : 0;
  }

  function bytes(value) {
    value = number(value);
    if (value < 1024) return Math.round(value) + ' B';
    var units = ['KiB', 'MiB', 'GiB', 'TiB'];
    var unit = -1;
    do {
      value /= 1024;
      unit += 1;
    } while (value >= 1024 && unit < units.length - 1);
    return (value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)) + ' ' + units[unit];
  }

  function rate(value) {
    var bits = number(value) * 8;
    if (bits < 1000) return Math.round(bits) + ' bps';
    if (bits < 1000000) return (bits / 1000).toFixed(bits >= 100000 ? 0 : 1) + ' Kbps';
    if (bits < 1000000000) return (bits / 1000000).toFixed(bits >= 100000000 ? 0 : 1) + ' Mbps';
    return (bits / 1000000000).toFixed(2) + ' Gbps';
  }

  function interfaceLabel(name) {
    var low = String(name || '').toLowerCase();
    if (low === 'en0' || low.indexOf('wi-fi') >= 0 || low.indexOf('wifi') >= 0) return 'Wi-Fi';
    if (/^pdp_ip\d+$/.test(low) || low.indexOf('cell') >= 0) return 'Cellular';
    if (/^utun\d+$/.test(low) || low.indexOf('tunnel') >= 0) return 'Tunnel';
    return name || 'Interface';
  }

  function usableInterfaces(map) {
    return Object.keys(map || {}).filter(function (name) {
      if (name === 'lo0') return false;
      var item = map[name];
      return item && typeof item === 'object';
    }).sort(function (a, b) {
      var left = number(map[a].in) + number(map[a].out);
      var right = number(map[b].in) + number(map[b].out);
      return right - left;
    });
  }

  function preferredInterface(names, map) {
    var stored = '';
    try { stored = $persistentStore.read(SELECTED_KEY) || ''; } catch (e) {}
    if (names.indexOf(stored) >= 0) return stored;

    var wifiActive = typeof $network !== 'undefined' && $network && $network.wifi && $network.wifi.ssid;
    if (wifiActive && names.indexOf('en0') >= 0) return 'en0';

    var cellularActive = typeof $network !== 'undefined' && $network && $network['cellular-data'];
    if (cellularActive) {
      var cellular = names.filter(function (name) { return /^pdp_ip\d+$/.test(name); });
      if (cellular.length) return cellular[0];
    }

    return names[0];
  }

  function nextInterface(current, names) {
    if (!manual || names.length < 2) return current;
    var index = names.indexOf(current);
    return names[(index + 1) % names.length];
  }

  api('/v1/traffic').then(function (traffic) {
    var map = traffic.interface || {};
    var names = usableInterfaces(map);
    if (!names.length) {
      $done({
        title: 'LIVE TRAFFIC',
        content: 'No traffic interface is available\nSurge may still be starting',
        icon: 'waveform.path.ecg',
        'icon-color': '#9A7647'
      });
      return;
    }

    var selected = nextInterface(preferredInterface(names, map), names);
    try { $persistentStore.write(selected, SELECTED_KEY); } catch (e) {}
    var item = map[selected] || {};
    var label = interfaceLabel(selected);

    var content = 'Now   ↓ ' + rate(item.inCurrentSpeed) + ' · ↑ ' + rate(item.outCurrentSpeed) + '\n' +
                  'Session ↓ ' + bytes(item.in) + ' · ↑ ' + bytes(item.out) + '\n' +
                  'Peak   ↓ ' + rate(item.inMaxSpeed) + ' · ↑ ' + rate(item.outMaxSpeed) + '\n' +
                  label + ' · ' + selected + (names.length > 1 ? ' · refresh cycles' : '');

    var color = label === 'Wi-Fi' ? '#4A789C' : label === 'Cellular' ? '#497C64' : '#7667A8';
    $done({
      title: 'LIVE TRAFFIC',
      content: content,
      icon: label === 'Wi-Fi' ? 'wifi' : label === 'Cellular' ? 'antenna.radiowaves.left.and.right' : 'arrow.up.arrow.down.circle',
      'icon-color': color
    });
  }).catch(function (error) {
    $done({
      title: 'LIVE TRAFFIC',
      content: 'Traffic data unavailable\n' + String(error || ''),
      icon: 'exclamationmark.circle',
      'icon-color': '#B85C5C'
    });
  });
})();
