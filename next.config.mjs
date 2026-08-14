/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // In production Vercel routes /api/* to the Python serverless function via
    // vercel.json. The dev server knows nothing about that, so proxy to a
    // locally running uvicorn instead -- see `npm run dev:api`.
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
