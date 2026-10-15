import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s));

export const tradesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(50).optional(),
    symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9&_-]{1,20}$/, 'invalid symbol').optional(),
    sortBy: z.enum(['timestamp', 'tradeId', 'client', 'symbol', 'quantity', 'price']).default('timestamp'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must not be after "to"', path: ['from'] });

export const jobsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

export const emptyQuerySchema = z.object({}).strict();

/** Query strings are parsed with the "simple" parser, so nested operator objects can never appear. */
export const validateQuery = (schema) => (req, _res, next) => {
  try {
    req.validatedQuery = schema.parse(req.query);
    next();
  } catch (err) { next(err); }
};
