/**
 * Nginx service - generate preview configuration
 */

const config = require('../config');

/**
 * Generate nginx server block for preview subdomain (SSL)
 */
function generatePreviewConfig(sessionId, containerPort) {
  return `
server {
    listen 443 ssl;
    server_name ${sessionId}.${config.PREVIEW_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${config.PREVIEW_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${config.PREVIEW_DOMAIN}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:${containerPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}

server {
    listen 80;
    server_name ${sessionId}.${config.PREVIEW_DOMAIN};
    return 301 https://$host$request_uri;
}
`.trim();
}

/**
 * Generate nginx server block for static file serving (no container needed)
 */
function generateStaticPreviewConfig(appId, staticDir) {
  return `
server {
    listen 443 ssl;
    server_name ${appId}.${config.PREVIEW_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${config.PREVIEW_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${config.PREVIEW_DOMAIN}/privkey.pem;

    root ${staticDir};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}

server {
    listen 80;
    server_name ${appId}.${config.PREVIEW_DOMAIN};
    return 301 https://$host$request_uri;
}
`.trim();
}

/**
 * Generate nginx server block for custom domain (HTTP only — certbot adds SSL later)
 */
function generateCustomDomainConfig(domain, staticDir) {
  return `
server {
    listen 80;
    server_name ${domain};

    root ${staticDir};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
`.trim();
}

function getConfigPath(sessionId) {
  return '/etc/nginx/sites-available/buidlr-preview-' + sessionId;
}

module.exports = {
  generatePreviewConfig,
  generateStaticPreviewConfig,
  generateCustomDomainConfig,
  getConfigPath
};
