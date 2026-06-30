FROM node:20-slim

WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm install

COPY . .
RUN npm run build && npm run seed

ENV NODE_ENV=production
ENV PORT=7860
ENV DATABASE_PATH=/app/server/db/team_worklog.sqlite

EXPOSE 7860
CMD ["npm", "start"]
