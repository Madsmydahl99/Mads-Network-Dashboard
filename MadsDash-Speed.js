/* Mads Network Dashboard v2 — SPEED
 * Manual-only quick Cloudflare test.
 * Total measurement payload is ~3 MiB: 2 MiB download + 1 MiB upload.
 * Also measures unloaded latency/jitter with three tiny probes.
 */
(function () {
  var LAST_KEY = 'MadsDash.Speed.LastResult.v2';
  var DOWNLOAD_BYTES = 2 * 1024 * 1024;
  var UPLOAD_BYTES = 1 * 1024 * 1024;

  function readLast() {
    try {
      var raw = $persistentStore.read(LAST_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveLast(value) {
    try { $persistentStore.write(JSON.stringify(value), LAST_KEY); } catch (e) {}
  }

  function idle() {
    var last = readLast();
    if (last && last.down !== undefined) {
      $done({
        title: 'SPEED',
        content: '↓ Download ' + last.down + ' Mbps\n' +
                 '↑ Upload ' + last.up + ' Mbps\n' +
                 'Latency ' + last.latency + 'ms · Jitter ' + last.jitter + 'ms\n' +
                 '↻ Refresh = new 3 MiB quick test',
        icon: last.icon || 'speedometer',
        'icon-color': last.color || '#4A789C'
      });
    } else {
      $done({
        title: 'SPEED',
        content: '↓ Download —\n↑ Upload —\nLatency —\n↻ Refresh = 3 MiB quick test',
        icon: 'speedometer',
        'icon-color': '#6D7480'
      });
    }
  }

  if (typeof $trigger === 'undefined' || $trigger !== 'button') {
    idle();
    return;
  }

  function probeOnce(done) {
    var t0 = Date.now();
    $httpClient.get({
      url: 'https://cp.cloudflare.com/generate_204',
      timeout: 3,
      'auto-cookie': false,
      headers: { 'User-Agent': 'Surge-MadsDash/2.0' }
    }, function (error) {
      done(error ? null : (Date.now() - t0));
    });
  }

  function measureLatency(done) {
    var values = [];
    function next() {
      if (values.length >= 3) {
        var valid = values.filter(function (v) { return v !== null; }).sort(function (a, b) { return a - b; });
        if (!valid.length) { done(null, null); return; }
        var median = valid[Math.floor(valid.length / 2)];
        var avg = valid.reduce(function (s, v) { return s + v; }, 0) / valid.length;
        var jitter = Math.round(valid.reduce(function (s, v) { return s + Math.abs(v - avg); }, 0) / valid.length);
        done(Math.round(median), jitter);
        return;
      }
      probeOnce(function (v) { values.push(v); next(); });
    }
    next();
  }

  function measureDownload(done) {
    var started = Date.now();
    $httpClient.get({
      url: 'https://speed.cloudflare.com/__down?bytes=' + DOWNLOAD_BYTES,
      timeout: 20,
      'auto-cookie': false,
      'binary-mode': true,
      headers: { 'User-Agent': 'Surge-MadsDash/2.0', 'Cache-Control': 'no-cache' }
    }, function (error, response) {
      if (error || !response || response.status < 200 || response.status >= 300) {
        done(null, error || ('HTTP ' + (response ? response.status : 'unknown')));
        return;
      }
      var sec = Math.max((Date.now() - started) / 1000, 0.01);
      done(Math.round((DOWNLOAD_BYTES * 8 / 1000000) / sec), null);
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
      headers: {
        'User-Agent': 'Surge-MadsDash/2.0',
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache'
      }
    }, function (error, response) {
      if (error || !response || response.status < 200 || response.status >= 300) {
        done(null, error || ('HTTP ' + (response ? response.status : 'unknown')));
        return;
      }
      var sec = Math.max((Date.now() - started) / 1000, 0.01);
      done(Math.round((UPLOAD_BYTES * 8 / 1000000) / sec), null);
    });
  }

  measureLatency(function (latency, jitter) {
    measureDownload(function (down, downError) {
      if (down === null) {
        $done({
          title: 'SPEED',
          content: 'Download test failed\n' + String(downError || 'Unknown error') + '\nNo upload test was run',
          icon: 'exclamationmark.circle',
          'icon-color': '#B85C5C'
        });
        return;
      }

      measureUpload(function (up, upError) {
        if (up === null) {
          $done({
            title: 'SPEED',
            content: '↓ Download ' + down + ' Mbps\n↑ Upload failed\n' + String(upError || 'Unknown error') + '\n2 MiB ↓ completed',
            icon: 'exclamationmark.triangle',
            'icon-color': '#9A7647'
          });
          return;
        }

        var l = latency === null ? '—' : latency;
        var j = jitter === null ? '—' : jitter;
        var icon = down < 20 ? 'tortoise' : (down < 100 ? 'hare' : 'bolt');
        var color = down < 20 ? '#9A7647' : (down < 100 ? '#4A789C' : '#497C64');
        var result = { down: down, up: up, latency: l, jitter: j, icon: icon, color: color, at: Date.now() };
        saveLast(result);

        $done({
          title: 'SPEED',
          content: '↓ Download ' + down + ' Mbps\n' +
                   '↑ Upload ' + up + ' Mbps\n' +
                   'Latency ' + l + 'ms · Jitter ' + j + 'ms\n' +
                   'Quick test · 2 MiB ↓ + 1 MiB ↑',
          icon: icon,
          'icon-color': color
        });
      });
    });
  });
})();
