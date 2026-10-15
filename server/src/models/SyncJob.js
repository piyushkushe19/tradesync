import mongoose from 'mongoose';

export const ACTIVE_STATUSES = ['queued', 'running'];
export const TERMINAL_STATUSES = ['completed', 'failed'];

const syncJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued', required: true },
    phase: { type: String, default: 'queued' },
    startedAt: Date,
    completedAt: Date,
    durationMs: Number,
    expectedTradeCount: Number,
    processedTradeCount: { type: Number, default: 0 },
    insertedTradeCount: { type: Number, default: 0 },
    updatedTradeCount: { type: Number, default: 0 },
    rejectedTradeCount: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },
    errorMessage: String,
    exchangeOperationId: String,
    exchangeReadyAt: Date,
    deadlineAt: Date,
  },
  { timestamps: true, versionKey: false },
);

syncJobSchema.index({ status: 1 });
syncJobSchema.index({ createdAt: -1 });
syncJobSchema.index({ status: 1, completedAt: -1 });

export const SyncJob = mongoose.models.SyncJob || mongoose.model('SyncJob', syncJobSchema);
