FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (without build tools first)
RUN npm install --only=production --no-optional

# Copy app source
COPY . .

# Start the bot
CMD ["npm", "start"] 