import mongoose from 'mongoose';

/**
 * Money is stored as an integer number of paise (priceMinor = price * 100) so that
 * aggregations such as SUM(price * quantity) never accumulate binary floating point
 * error. The API converts to rupees only at the edge (see utils/serialize.js).
 */
const tradeSchema = new mongoose.Schema(
  {
    tradeId: { type: String, required: true, unique: true, trim: true, match: /^[A-Za-z0-9_-]{3,40}$/ },
    client: { type: String, required: true, trim: true, maxlength: 40 },
    symbol: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'quantity must be an integer' },
    },
    priceMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'priceMinor must be an integer' },
    },
    // Denormalised priceMinor * quantity: keeps value aggregations an exact integer $sum.
    notionalMinor: { type: Number, required: true, min: 1 },
    timestamp: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);

tradeSchema.index({ timestamp: -1, tradeId: 1 });
tradeSchema.index({ symbol: 1, timestamp: -1 });
tradeSchema.index({ client: 1, timestamp: -1 });

export const Trade = mongoose.models.Trade || mongoose.model('Trade', tradeSchema);
