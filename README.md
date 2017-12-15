# beebot
BBona

## Installation
On Linux - run `npm i`

On Windows - ask nuuls (xd).
Or install node-canvas yourself, see https://github.com/Automattic/node-canvas/wiki/Installation---Windows, then run `npm i`


Then copy the `config.default.json` file to `config.json`, enter your credentials and run it with `node index.js`

## Usage
Add the bot to your discord server with the correct privileges and then run `/bee :emote:`
The bot spawns an HTTP server on port 3002 on localhost, so you can use that - `http://host/bee?url=<url>`

## Docker

### Build the container
You can build the container with the following command `npm run docker`

### Run the image
Running your image with -d runs the container in detached mode, leaving the container running in the background. The -p flag redirects a public port to a private port inside the container. Run the image you previously built:
```bash
$ docker run -p 3002:3002 -d beebot:latest
```