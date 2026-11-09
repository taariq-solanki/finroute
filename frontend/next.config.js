/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  async headers() {
    // Next.js 12 dev mode uses eval() for hot-reload, which a strict
    // `script-src 'self'` blocks (blank page locally). Allow 'unsafe-eval'
    // ONLY in development; production keeps the hardened policy (Req 8.4).
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-eval'"
      : "script-src 'self'";
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com https://*.amazonaws.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
            ].join('; '),
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
