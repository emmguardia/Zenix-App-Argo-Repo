import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let client = null;

function getR2() {
  if (!client) {
    client = new S3Client({
      region:   'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

const BUCKET = () => process.env.R2_BUCKET;

/**
 * Content-Disposition : repli ASCII (accents translittérés) + nom UTF-8
 * complet en filename* (RFC 5987) — sinon « Devis février.pdf » se
 * télécharge en « Devis%20f%C3%A9vrier.pdf ».
 */
export function contentDisposition(filename) {
  const ascii = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(filename)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * URL signée de téléchargement, courte durée (5 min).
 * ⚠️ L'appartenance du document à l'organisation DOIT être vérifiée
 * par l'appelant AVANT de signer (anti-IDOR).
 */
export async function signedDownloadUrl(r2Key, filename) {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET(),
    Key:    r2Key,
    ResponseContentDisposition: contentDisposition(filename),
  });
  return getSignedUrl(getR2(), cmd, { expiresIn: 300 });
}

/** URL signée d'upload, courte durée (5 min). */
export async function signedUploadUrl(r2Key, contentType) {
  const cmd = new PutObjectCommand({
    Bucket:      BUCKET(),
    Key:         r2Key,
    ContentType: contentType,
  });
  return getSignedUrl(getR2(), cmd, { expiresIn: 300 });
}

/** Upload direct depuis le backend (fichiers reçus en multipart). */
export async function putObject(r2Key, buffer, contentType) {
  await getR2().send(new PutObjectCommand({
    Bucket:      BUCKET(),
    Key:         r2Key,
    Body:        buffer,
    ContentType: contentType,
  }));
}

export async function deleteObject(r2Key) {
  await getR2().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: r2Key }));
}

/** Lit un objet en mémoire (pour empreinte SHA-256 / tampon de signature). */
export async function getObjectBuffer(r2Key) {
  const res = await getR2().send(new GetObjectCommand({ Bucket: BUCKET(), Key: r2Key }));
  return Buffer.from(await res.Body.transformToByteArray());
}
