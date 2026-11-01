// Offline test: fake AC-MX-42X telnet server that mimics observed behavior
// (broadcast to all clients, CRLF lines, "OUTn VS INm" replies) and drives MatrixClient.
const net = require('node:net');
const { MatrixClient } = require('../dist/matrixClient');

const routes = { 1: 2, 2: 2 };
const clients = new Set();
const broadcast = (line) => { for (const c of clients) c.write(line + '\r\n'); };
const server = net.createServer((sock) => {
  clients.add(sock);
  sock.on('close', () => clients.delete(sock));
  let buf = '';
  sock.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const cmd = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
      let m;
      if ((m = /^(?:A00 )?GET OUT(\d) VS$/.exec(cmd))) {
        const o = +m[1];
        if (o === 0) { broadcast(`OUT1 VS IN${routes[1]}`); broadcast(`OUT2 VS IN${routes[2]}`); }
        else broadcast(`OUT${o} VS IN${routes[o]}`);
      } else if ((m = /^(?:A00 )?SET OUT(\d) VS IN(\d)$/.exec(cmd))) {
        if (process.env.FAIL_SET) return; // simulate no confirmation
        routes[+m[1]] = +m[2]; broadcast(`OUT${m[1]} VS IN${m[2]}`);
      }
    }
  });
});
const log = { info: (...a) => console.log('[info]', ...a), warn: (...a) => console.log('[warn]', ...a),
  error: (...a) => console.log('[error]', ...a), debug: () => {} };

setTimeout(() => { console.log("TIMEOUT - hung"); process.exit(2); }, 15000).unref();
server.listen(0, async () => {
  const port = server.address().port;
  const c = new MatrixClient(log, '127.0.0.1', port, 1000);
  const seen = [];
  c.on('route', (o, i) => seen.push(`${o}->${i}`));
  const connected = new Promise((r) => c.once('connected', r));
  c.start();
  await connected;
  await new Promise((r) => setTimeout(r, 200));
  console.assert(c.state[1] === 2 && c.state[2] === 2, 'initial poll should populate both outputs');

  // 1) confirmed switch
  console.log("step1"); await c.setRoute(2, 1, 2000); console.log("step1 done");
  console.assert(c.state[2] === 1 && c.state[1] === 2, 'OUT2 changed, OUT1 preserved');

  // 2) external change (web UI / front panel) is picked up via broadcast
  routes[1] = 1; broadcast('OUT1 VS IN1');
  await new Promise((r) => setTimeout(r, 100));
  console.assert(c.state[1] === 1, 'external change reflected');

  // 3) unconfirmed switch rejects
  process.env.FAIL_SET = '1';
  let rejected = false;
  try { await c.setRoute(2, 2, 800); } catch (e) { rejected = true; console.log('[ok] rejected:', e.message); }
  console.assert(rejected, 'should reject when device does not confirm');
  console.assert(c.state[2] === 1, 'state unchanged after failed set');
  delete process.env.FAIL_SET;

  // 4) reconnect after server drop
  for (const s of clients) s.destroy();
  await new Promise((r) => c.once('connected', r));
  console.log('[ok] reconnected');

  c.stop(); server.close();
  console.log('seen events:', seen.join(' '));
  console.log('ALL TESTS PASSED');
});
