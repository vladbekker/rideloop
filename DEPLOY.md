# Deploy RideLoop on a DigitalOcean Droplet

RideLoop is a static browser app, so a small Ubuntu Droplet with Nginx is enough.

## 1. Create the Droplet

- Image: Ubuntu LTS
- Size: the smallest basic Droplet is fine for personal use
- Authentication: SSH key
- Add a domain or subdomain later, such as `rideloop.example.com`

## 2. Point DNS at the Droplet

Create an `A` record:

```text
rideloop.example.com -> DROPLET_PUBLIC_IP
```

## 3. Install Nginx

SSH into the Droplet:

```bash
ssh root@DROPLET_PUBLIC_IP
```

Install packages:

```bash
apt update
apt install -y nginx git ufw
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw --force enable
```

## 4. Put the App on the Server

Clone the repo:

```bash
mkdir -p /var/www
cd /var/www
git clone git@github.com:vladbekker/rideloop.git
```

If the repo is private, add an SSH deploy key to GitHub or clone with a GitHub personal access token.

## 5. Configure Nginx

Create the site:

```bash
nano /etc/nginx/sites-available/rideloop
```

Paste this, replacing the domain:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name rideloop.example.com;

    root /var/www/rideloop;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable it:

```bash
ln -s /etc/nginx/sites-available/rideloop /etc/nginx/sites-enabled/rideloop
nginx -t
systemctl reload nginx
```

## 6. Add HTTPS

Install Certbot:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d rideloop.example.com
```

## 7. Update the App

When you push changes to GitHub:

```bash
cd /var/www/rideloop
git pull
```

## Notes

- Browser geolocation needs HTTPS outside localhost.
- API keys are not stored in the repo. RideLoop stores ORS/Google keys in browser local storage.
- For a public product, a backend proxy is safer so users do not need their own ORS key.
