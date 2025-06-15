FROM node:18-slim

# Print Node.js and npm versions for debugging
RUN node --version && npm --version

# Install required dependencies for @discordjs/opus and ffmpeg
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    git \
    build-essential \
    python3-pip \
    pkg-config \
    libtool \
    autoconf \
    automake \
    && rm -rf /var/lib/apt/lists/*

# Print installed Python version
RUN python3 --version

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Print package.json contents for debugging
RUN cat package.json

# Set environment variables for npm
ENV npm_config_python=/usr/bin/python3
ENV NODE_ENV=production
ENV npm_config_build_from_source=true
ENV npm_config_loglevel=verbose

# Install dependencies step by step with debugging
RUN echo "Installing node-gyp globally..." && \
    npm install -g node-gyp && \
    echo "node-gyp version:" && \
    node-gyp --version

RUN echo "Installing project dependencies..." && \
    npm install --verbose 2>&1 | tee npm-install.log

RUN echo "Cleaning npm cache..." && \
    npm cache clean --force

# Print npm debug log if installation failed
RUN if [ $? -ne 0 ]; then \
    echo "npm install failed. Debug log:" && \
    cat npm-install.log; \
    exit 1; \
    fi

# Copy app source
COPY . .

# Deploy commands
RUN echo "Deploying commands..." && \
    npm run deploy

# Start the bot
CMD ["npm", "start"] 