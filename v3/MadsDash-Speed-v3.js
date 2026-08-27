/* Mads Network Dashboard v3 — SPEED
 * Manual-only 3 MiB Cloudflare estimate: 2 MiB down + 1 MiB up.
 * Five tiny HTTP probes provide a median web RTT and median variation.
 */
(function () {
  var LAST_KEY = 'MadsDash.Speed.LastResult.v3';
  var DOWNLOAD_BYTES = 2 * 1024 * 1024;
  var UPLOAD_BYTES = 1 * 1024 * 1024;

  function timeText(timestamp) {
    if (!timestamp) return '';
    try {
      var date = new Date(timestamp);
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    } catch (e) {
      return '';
    }
  }

  function readLast() {
    try {
      var raw = $persistentStore.read(LAST_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveLast(value) {
    try { $persistentStore.write(JSON.stringify(value), LAST_KEY); } catch (e) {}
  }

  function idle() {
    var last = readLast();
    if (last && last.down !== undefined) {
      $done({
        title: 'SPEED · MANUAL',
        content: '↓ ' + last.down + ' Mbps · ↑ ' + last.up + ' Mbps\n' +
                 'Web RTT ' + last.latency + 'ms · variation ' + last.jitter + 'ms\n' +
                 'Last tested ' + timeText(last.at) + '\n' +
                 'Refresh runs a 3 MiB quick estimate',
        icon: last.icon || 'speedometer',
        'icon-color': last.color || '#4A789C'
      });
    } else {
      $done({
        title: 'SPEED · MANUAL',
        content: 'Download — · Upload —\nWeb RTT — · variation —\nNo test has been run yet\nRefresh uses 2 MiB ↓ + 1 MiB ↑',
        icon: 'speedometer',
        'icon-color': '#6D7480'
      });
    }
  }

  if (typeof $trigger === 'undefined' || $trigger !== 'button') {
    idle();
    return;
  }

  function median(values) {
    if (!values.length) return null;
    values = values.slice().sort(function (a, b) { return a - b; });
    return values[Math.floor(values.length / 2)];
  }

  function probe(done) {
    var started = Date.now();
    $httpClient.get({
      url: 'https://cp.cloudflare.com/generate_204',
      timeout: 3,
      'auto-cookie': false,
      'auto-redirect': false,
      headers: { 'User-Agent': 'Surge-MadsDash/3.0', 'Cache-Control': 'no-cache' }
    }, function (error, response) {
      var status = response ? Number(response.status || response.statusCode || 0) : 0;
      done(!error && status === 204 ? Date.now() - started : null);
    });
  }

  function measureLatency(done) {
    var values = [];
    function next() {
      if (values.length >= 5) {
        var valid = values.filter(function (value) { return value !== null; });
        if (!valid.length) {
          done(null, null);
          return;
        }
        var centre = median(valid);
        var deviations = valid.map(function (value) { return Math.abs(value - centre); });
        done(Math.round(centre), Math.round(median(deviations)));
        return;
      }
      probe(function (value) { values.push(value); next(); });
    }
    next();
  }

  function measureDownload(done) {
    var started = Date.now();
    $httpClient.get({
      url: 'https://speed.cloudflare.com/__down?bytes=' + DOWNLOAD_BYTES + '&t=' + Date.now(),
      timeout: 20,
      'auto-cookie': false,
      'auto-redirect': false,
      'binary-mode': true,
      headers: { 'User-Agent': 'Surge-MadsDash/3.0', 'Cache-Control': 'no-cache' }
    }, function (error, response) {
      var status = response ? Number(response.status || response.statusCode || 0) : 0;
      if (error || status < 200 || status >= 300) {
        done(null, error || ('HTTP ' + (status || 'unknown')));
        return;
      }
      var seconds = Math.max((Date.now() - started) / 1000, 0.01);
      done(Math.round((DOWNLOAD_BYTES * 8 / 1000000) / seconds), null);
    });
  }

  function measureUpload(done) {
    var payload = new Uint8Array(UPLOAD_BYTES);
    var started = Date.now();
    $httpClient.post({
      url: 'https://speed.cloudflare.com/__up',
      body: payload,
      timeout: 20,
      'auto-cookie': false,
      'auto-redirect': false,
      headers: {
        'User-Agent': 'Surge-MadsDash/3.0',
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache'
      }
    }, function (error, response) {
      var status = response ? Number(response.status || response.statusCode || 0) : 0;
      if (error || status < 200 || status >= 300) {
        done(null, error || ('HTTP ' + (status || 'unknown')));
        return;
      }
      var seconds = Math.max((Date.now() - started) / 1000, 0.01);
      done(Math.round((UPLOAD_BYTES * 8 / 1000000) / seconds), null);
    });
  }

  measureLatency(function (latency, jitter) {
    measureDownload(function (down, downError) {
      if (down === null) {
        $done({
          title: 'SPEED · MANUAL',
          content: 'Download estimate failed\n' + String(downError || 'Unknown error') + '\nUpload was not attempted',
          icon: 'exclamationmark.circle',
          'icon-color': '#B85C5C'
        });
        return;
      }

      measureUpload(function (up, upError) {
        if (up === null) {
          $done({
            title: 'SPEED · MANUAL',
            content: '↓ ' + down + ' Mbps · upload failed\n' + String(upError || 'Unknown error') + '\n2 MiB download completed',
            icon: 'exclamationmark.triangle',
            'icon-color': '#9A7647'
          });
          return;
        }

        var latencyText = latency === null ? '—' : latency;
        var jitterText = jitter === null ? '—' : jitter;
        var icon = down < 20 ? 'tortoise' : (down < 100 ? 'hare' : 'bolt');
        var color = down < 20 ? '#9A7647' : (down < 100 ? '#4A789C' : '#497C64');
        if (jitter !== null && jitter > 40) color = '#9A7647';

        var result = {
          down: down,
          up: up,
          latency: latencyText,
          jitter: jitterText,
          icon: icon,
          color: color,
          at: Date.now()
        };
        saveLast(result);

        $done({
          title: 'SPEED · MANUAL',
          content: '↓ ' + down + ' Mbps · ↑ ' + up + ' Mbps\n' +
                   'Web RTT ' + latencyText + 'ms · variation ' + jitterText + 'ms\n' +
                   'Quick estimate · 2 MiB ↓ + 1 MiB ↑\n' +
                   'Tested ' + timeText(result.at),
          icon: icon,
          'icon-color': color
        });
      });
    });
  });
})();
