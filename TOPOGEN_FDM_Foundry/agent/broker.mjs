import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const LIMIT = 262144; // 256 KB

export function frame(value) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.length > LIMIT) throw Error('Agent tool frame exceeds limit');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([header, bytes]);
}

export function readFrame(socket, done) {
  let bytes = Buffer.alloc(0);
  let settled = false;
  const receive = chunk => {
    if (settled) return;
    bytes = Buffer.concat([bytes, chunk]);
    if (bytes.length < 4) return;
    const size = bytes.readUInt32LE(0);
    if (size > LIMIT) {
      settled = true;
      socket.destroy(Error('Agent tool frame exceeds limit'));
      return;
    }
    if (bytes.length >= size + 4) {
      settled = true;
      socket.removeListener('data', receive);
      try {
        done(null, JSON.parse(bytes.subarray(4, size + 4).toString('utf8')));
      } catch (error) {
        done(error);
      }
    }
  };
  socket.on('data', receive);
}

export async function createBroker(stateDir, handler) {
  const id = crypto.randomUUID();
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\topogen-foundry-${id}`
    : path.join(stateDir, `${id}.sock`);
  const sockets = new Set();

  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(185000, () => socket.destroy());
    readFrame(socket, async (error, value) => {
      let response;
      try {
        if (error) throw error;
        response = await handler(value);
      } catch (e) {
        response = { ok: false, error: e?.message || String(e) };
      }
      if (!socket.destroyed) {
        try {
          socket.once('data', () => socket.end());
          socket.write(frame(response));
        } catch {
          socket.destroy();
        }
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, resolve);
  });

  return {
    endpoint,
    close: () => new Promise(resolve => {
      for (const s of sockets) s.destroy();
      server.close(() => {
        if (process.platform !== 'win32') {
          try { fs.rmSync(endpoint, { force: true }); } catch {}
        }
        resolve();
      });
    })
  };
}

export function brokerCall(endpoint, request, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint);
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(Error('Agent tool request timed out; operation was not replayed')));
    socket.on('error', error => finish(error));
    socket.on('end', () => {
      if (!settled) finish(Error('Agent tool broker disconnected; operation was not replayed'));
    });
    socket.once('connect', () => {
      try {
        socket.write(frame(request));
      } catch (e) {
        finish(e);
      }
    });
    readFrame(socket, (error, result) => {
      if (error) finish(error);
      else socket.write(Buffer.from([1]), () => finish(null, result));
    });
  });
}
