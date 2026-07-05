import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

const ORIGIN = process.env.FRONTEND_URL || 'https://app.zenixweb.fr';

const clientIp = (req) => req.headers['cf-connecting-ip'] || req.ip;

export const globalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    clientIp,
  message:         { error: 'Trop de requêtes, réessayez dans 15 minutes' },
});

export const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    clientIp,
  message:         { error: 'Trop de tentatives, réessayez dans 15 minutes' },
});

export const ticketLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    clientIp,
  message:         { error: 'Trop de tickets soumis, réessayez plus tard' },
});

export function applySecurityMiddleware(app) {
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));

  app.use(cors({
    origin:         ORIGIN,
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }));

  app.use(compression());
  app.use('/api/', (req, res, next) => {
    if (req.path === '/health') return next();
    return globalLimiter(req, res, next);
  });
}
