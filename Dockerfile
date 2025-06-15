FROM node:18-slim

# Install required dependencies for @discordjs/opus and ffmpeg
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Set npm config
RUN npm config set python /usr/bin/python3

# Install dependencies with specific flags
RUN npm install --production --no-optional --no-audit --no-fund

# Copy app source
COPY . .

# Deploy commands
RUN npm run deploy

# Start the bot
CMD ["npm", "start"] 