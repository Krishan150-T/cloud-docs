import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DB_HOST ,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  name: process.env.DB_NAME,
}));

export const awsConfig = registerAs('aws', () => ({
  region: process.env.AWS_REGION,
  s3Bucket: process.env.S3_BUCKET_NAME,
}));

export default databaseConfig;