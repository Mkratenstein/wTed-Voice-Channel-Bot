FROM node:18-slim

# Install required dependencies for @discordjs/opus and ffmpeg
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Deploy commands
RUN npm run deploy

# Start the bot
CMD ["npm", "start"] 