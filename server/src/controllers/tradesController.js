import { listTrades, getStats } from '../services/tradeService.js';

export const tradesController = {
  async list(req, res) {
    const { items, pagination } = await listTrades(req.validatedQuery);
    res.json({ success: true, data: items, meta: { pagination } });
  },
  async stats(_req, res) {
    res.json({ success: true, data: await getStats() });
  },
};
