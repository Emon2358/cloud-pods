/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 本番環境用のセキュリティやヘッダー設定は Vercel の環境変数・Edge Functions 等で更に強化してください
};

module.exports = nextConfig;

