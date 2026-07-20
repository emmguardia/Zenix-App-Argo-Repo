import multer from 'multer';

/**
 * Upload d'un fichier unique en mémoire, avec des erreurs propres :
 * type refusé ou fichier trop lourd → 400 explicite. Jamais de fichier
 * ignoré en silence (l'ancien fileFilter jetait la pièce jointe sans
 * prévenir le client), jamais de 500 générique pour un dépassement de taille.
 */
export function singleUpload({ field = 'file', mimetypes, maxMb, label }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (mimetypes.includes(file.mimetype)) return cb(null, true);
      const err = new Error(`type refusé: ${file.mimetype}`);
      err.code = 'BAD_FILE_TYPE';
      cb(err);
    },
  }).single(field);

  return (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'BAD_FILE_TYPE') {
        return res.status(400).json({ error: `Format de fichier non accepté — ${label} uniquement` });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Fichier trop volumineux (${maxMb} Mo maximum)` });
      }
      next(err);
    });
  };
}
