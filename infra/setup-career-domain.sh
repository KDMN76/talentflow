#!/usr/bin/env bash
#
# setup-career-domain.sh — koppel een tenant-eigen (sub)domein aan TalentFlow's
# career-pages. Herbruikbaar voor elke white-label-klant.
#
# Wat het doet:
#   1. genereert een nginx-vhost die <domein> naar de web-container proxyt
#      (127.0.0.1:31000) met de originele Host-header — zodat de Next.js
#      middleware het custom domein ziet en naar /careers/<slug> rewrite;
#   2. proxyt /api/ naar de api-container (voor de publieke apply-flow);
#   3. vraagt via certbot een Let's Encrypt-certificaat aan (HTTP-01);
#   4. herlaadt nginx.
#
# VEREISTE VOORAF: het DNS A-record <domein> -> 91.98.232.104 moet al live zijn
# (certbot HTTP-01 valideert door het domein op te halen). Check met:
#   dig +short <domein>   # moet 91.98.232.104 teruggeven
#
# Gebruik (op de VPS, als root):
#   /opt/talentflow/infra/setup-career-domain.sh werkenbij.kdmnprojecten.com
#
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="kaanduman76@icloud.com"
VPS_IP="91.98.232.104"

if [ -z "$DOMAIN" ]; then
  echo "Gebruik: $0 <volledige-hostname>   (bv. werkenbij.kdmnprojecten.com)" >&2
  exit 1
fi

# Sanity: domein moet naar deze VPS wijzen vóór we certbot draaien.
RESOLVED=$(dig +short "$DOMAIN" A | tail -n1 || true)
if [ "$RESOLVED" != "$VPS_IP" ]; then
  echo "WAARSCHUWING: $DOMAIN resolvet naar '${RESOLVED:-niets}', verwacht $VPS_IP." >&2
  echo "Zet eerst het DNS A-record en wacht op propagatie. Doorgaan kan certbot laten falen." >&2
  read -r -p "Toch doorgaan? [y/N] " ans
  [ "$ans" = "y" ] || exit 1
fi

VHOST="/etc/nginx/sites-available/${DOMAIN}.conf"
mkdir -p /var/www/certbot

# ── HTTP-only vhost (genoeg voor de ACME-challenge + eerste reload) ─────────
cat > "$VHOST" <<NGINX
# Auto-gegenereerd door setup-career-domain.sh — white-label career-domein.
upstream cd_web_${DOMAIN//[.-]/_} { server 127.0.0.1:31000; keepalive 16; }
upstream cd_api_${DOMAIN//[.-]/_} { server 127.0.0.1:40000; keepalive 16; }

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    gzip on; gzip_vary on; gzip_min_length 1024; gzip_proxied any; gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;
    client_max_body_size 25m;

    # Publieke apply-flow + resolve gaan naar de api-container.
    location /api/ {
        proxy_pass http://cd_api_${DOMAIN//[.-]/_};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_buffering off;
    }

    location /_next/static/ {
        proxy_pass http://cd_web_${DOMAIN//[.-]/_};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # Alles anders → web-container. Host \$host is cruciaal: de Next.js
    # middleware leest die en rewrite custom-domein → /careers/<slug>.
    location / {
        proxy_pass http://cd_web_${DOMAIN//[.-]/_};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NGINX

# certbot heeft een geldige HTTPS-block nodig of draait standalone; we laten
# certbot --nginx het cert plaatsen. Eerst een tijdelijke HTTP-only enable zodat
# de ACME-challenge werkt, dan certbot die de ssl-regels invult.
# Truc: verwijder de 443-block tijdelijk voor de eerste certbot-run.
TMP_VHOST=$(mktemp)
sed '/listen 443/,/^}/d' "$VHOST" > "$TMP_VHOST"
cp "$TMP_VHOST" "$VHOST"
ln -sf "$VHOST" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t && systemctl reload nginx

certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
  --non-interactive --agree-tos --email "$EMAIL"

# Nu de volledige vhost (met 443) herstellen en herladen.
cat > "$VHOST" <<NGINX
upstream cd_web_${DOMAIN//[.-]/_} { server 127.0.0.1:31000; keepalive 16; }
upstream cd_api_${DOMAIN//[.-]/_} { server 127.0.0.1:40000; keepalive 16; }
server {
    listen 80; listen [::]:80; server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2; listen [::]:443 ssl http2; server_name ${DOMAIN};
    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    gzip on; gzip_types text/plain text/css application/json application/javascript image/svg+xml;
    client_max_body_size 25m;
    location /api/ { proxy_pass http://cd_api_${DOMAIN//[.-]/_}; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; proxy_read_timeout 120s; proxy_buffering off; }
    location /_next/static/ { proxy_pass http://cd_web_${DOMAIN//[.-]/_}; proxy_http_version 1.1; proxy_set_header Host \$host; add_header Cache-Control "public, max-age=31536000, immutable" always; }
    location / { proxy_pass http://cd_web_${DOMAIN//[.-]/_}; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; proxy_read_timeout 60s; }
}
NGINX

nginx -t && systemctl reload nginx
echo "KLAAR: https://${DOMAIN} serveert nu de gekoppelde career-page (mits custom_domain in de app is gezet + geverifieerd)."
