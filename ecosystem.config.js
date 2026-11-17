// Lancement : pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'epos-brief',
      script: 'src/server.js',
      instances: 1, // une seule instance : le planificateur ne doit tourner qu'une fois
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
      },
    },
  ],
};
