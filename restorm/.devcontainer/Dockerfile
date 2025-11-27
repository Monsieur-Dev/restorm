FROM node:24-bullseye

# Install system dependencies for Electron
RUN apt-get update && apt-get install -y \
    libnss3-dev \
    libatk-bridge2.0-dev \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxss1 \
    libasound2 \
    libxkbcommon0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libsecret-1-0 \
    libvulkan1 \
    libatomic1 \
    libstdc++6 \
    libdbus-glib-1-2 \
    libappindicator3-1 \
    libxkbfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install Git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install sudo and set up user
RUN apt-get update && apt-get install -y sudo && rm -rf /var/lib/apt/lists/* \
    && usermod --uid 1000 --gid 1000 node \
    && mkdir -p /home/node \
    && chown -R node:node /home/node \
    && echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Switch to node user
USER node

# Set working directory
WORKDIR /workspace

# Keep container running
CMD ["sleep", "infinity"]
