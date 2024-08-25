FROM python:3.9-slim

# Installer les dépendances du système
RUN apt-get update && apt-get install -y wget ffmpeg

# Installer yt-dlp
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Installer Node.js
RUN apt-get install -y nodejs npm

# Copier les fichiers de l'application
WORKDIR /app
COPY . .

# Installer les dépendances de l'application Node.js
RUN npm install

# Exposer le port
EXPOSE 5555

# Démarrer l'application
CMD ["node", "index.js"]