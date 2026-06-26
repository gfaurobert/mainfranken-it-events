/** @type {import('pm2').StartOptions} */
module.exports = {
  apps: [
    {
      name: "mainfranken-api-dev",
      script: "pnpm",
      args: "run dev",
      interpreter: "none",
      cwd: __dirname,
      env: {
        NODE_ENV: "development",
      },
    },
    {
      name: "mainfranken-demo",
      script: "pnpm",
      args: "run demo",
      interpreter: "none",
      cwd: __dirname,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
