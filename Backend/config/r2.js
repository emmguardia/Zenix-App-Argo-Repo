import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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
 * URL signée de téléchargement, courte durée (5 min).
 * ⚠️ L'appartenance du document à l'organisation DOIT être vérifiée
 * par l'appelant AVANT de signer (anti-IDOR).
 */
export async function signedDownloadUrl(r2Key, filename) {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET(),
    Key:    r2Key,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
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
