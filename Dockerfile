FROM node:18-slim

# Install necessary dependencies using Debian's package manager.
# build-essential includes the C/C++ compiler and related tools.
# --no-install-recommends keeps the image smaller.
# We clean up the apt cache at the end to reduce image size.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
    python3 && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package configuration
COPY package.json ./

# Install dependencies. This will now succeed in the Debian environment.
RUN npm install --only=production --no-optional

# Copy the rest of the application source code
COPY . .

# Command to run the bot
CMD ["npm", "start"]