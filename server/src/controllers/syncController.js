export function createSyncController({ syncService }) {
  return {
    async start(_req, res) {
      const job = await syncService.requestSync();
      res.status(202).location(`/api/sync/status`).json({
        success: true,
        data: { jobId: job.jobId, status: job.status, message: 'Trade synchronization queued successfully', createdAt: job.createdAt },
      });
    },
    async status(_req, res) {
      res.json({ success: true, data: await syncService.getStatus() });
    },
    async jobs(req, res) {
      const { page, limit } = req.validatedQuery;
      const { items, total } = await syncService.listJobs({ page, limit });
      res.json({ success: true, data: items, meta: { pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } } });
    },
  };
}
