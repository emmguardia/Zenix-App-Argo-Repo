import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { singleUpload } from '../middleware/upload.js';

/* Requête multipart synthétique : un flux lisible + les en-têtes que
   multer/busboy attendent. */
function multipartReq(parts, boundary = 'testboundary') {
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}\r\n` +
      (p.type ? `Content-Type: ${p.type}\r\n` : '') +
      '\r\n'
    ));
    chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);

  const req = Readable.from([body]);
  req.method = 'POST';
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  return req;
}

/* Exécute le middleware et attend soit next(), soit une réponse JSON. */
function run(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; resolve({ res: this, nexted: false, req }); return this; },
    };
    mw(req, res, (err) => resolve({ res, nexted: true, err, req }));
  });
}

const mw = singleUpload({ mimetypes: ['application/pdf'], maxMb: 1, label: 'PDF' });

test('upload : fichier accepté → next(), req.file rempli et champs texte parsés', async () => {
  const req = multipartReq([
    { name: 'title', data: 'Changer les horaires' },
    { name: 'file', filename: 'doc.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 test') },
  ]);
  const out = await run(mw, req);
  assert.equal(out.nexted, true);
  assert.equal(out.err, undefined);
  assert.equal(out.req.file.mimetype, 'application/pdf');
  assert.equal(out.req.file.originalname, 'doc.pdf');
  assert.equal(out.req.body.title, 'Changer les horaires');
});

test('upload : type refusé → 400 explicite (plus de fichier ignoré en silence)', async () => {
  const req = multipartReq([
    { name: 'file', filename: 'virus.exe', type: 'application/x-msdownload', data: 'MZ...' },
  ]);
  const out = await run(mw, req);
  assert.equal(out.nexted, false);
  assert.equal(out.res.statusCode, 400);
  assert.match(out.res.body.error, /PDF/);
});

test('upload : fichier trop lourd → 400 avec la limite (plus de 500 générique)', async () => {
  const req = multipartReq([
    { name: 'file', filename: 'gros.pdf', type: 'application/pdf', data: Buffer.alloc(2 * 1024 * 1024) },
  ]);
  const out = await run(mw, req);
  assert.equal(out.nexted, false);
  assert.equal(out.res.statusCode, 400);
  assert.match(out.res.body.error, /1 Mo/);
});

test('upload : requête JSON (sans multipart) → passe sans toucher au body', async () => {
  const req = Readable.from([Buffer.from('{}')]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json', 'content-length': '2' };
  req.body = { title: 'test' };
  const out = await run(mw, req);
  assert.equal(out.nexted, true);
  assert.deepEqual(out.req.body, { title: 'test' });
});
