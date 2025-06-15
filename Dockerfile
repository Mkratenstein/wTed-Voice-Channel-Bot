FROM node:18-alpine

# Install FFmpeg for audio and build-tools for native module compilation.
# The .build-deps is a virtual package that lets us uninstall all build tools easily later.
RUN apk add --no-cache ffmpeg && \
    apk add --no-cache --virtual .build-deps build-base python3

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies. This will use the build tools for @discordjs/opus.
RUN npm install --only=production --no-optional

# Remove the build dependencies now that we're done with them.
RUN apk del .build-deps

# Copy app source
COPY . .

# Start the bot
CMD ["npm", "start"] 