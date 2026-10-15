import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

export async function connectMongo(logger) {
  mongoose.connection.on('disconnected', () => logger?.warn('mongo.disconnected'));
  mongoose.connection.on('reconnected', () => logger?.info('mongo.reconnected'));
  mongoose.connection.on('error', (err) => logger?.error('mongo.error', { err }));
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20 });
  logger?.info('mongo.connected');
  return mongoose.connection;
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}
