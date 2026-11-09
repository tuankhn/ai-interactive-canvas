/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Recommended for complex canvas drawing & pointer handlers
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8000',
        pathname: '/uploads/**',
      },
    ],
  },
};

export default nextConfig;
