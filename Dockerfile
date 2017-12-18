FROM ubuntu
MAINTAINER Styler

WORKDIR /usr/src/app
COPY package*.json ./

RUN apt-get update && apt-get -qq -y install curl
RUN curl -sL https://deb.nodesource.com/setup_9.x | bash -
RUN apt-get install -y \
  nodejs \
  libcairo2-dev \
  libjpeg8-dev \
  libpango1.0-dev \
  libgif-dev \
  build-essential \
  g++

RUN npm install

EXPOSE 3002
COPY . .

CMD [ "npm", "start" ]