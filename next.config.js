module.exports = {
  reactStrictMode: false,
  experimental: {
    // ship the brand newsletter templates with the API functions on Vercel
    outputFileTracingIncludes: { '/api/**/*': ['./lib/templates/**'] },
  },
};
