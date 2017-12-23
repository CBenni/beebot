const _ = require('lodash');
const express = require('express');
const Discord = require('discord.js');
const Canvas = require('canvas');

const { Image } = Canvas;

const twemoji = require('./twemoji');

const app = express();
const config = require('./config.default.json');

try {
  // eslint-disable-next-line global-require
  _.extend(config, require('./config'));
} catch (err) {
  console.log('No config.json found!');
}

function all(x, c) {
  if (_.isArray(x)) _.each(x, c);
  else c(x);
}

const { templates } = config;

_.each(templates, data => {
  all(data, template => {
    template.image = new Image();
    template.image.src = template.src;
  });
});

// drawing: we keep the image fixed in its default position and draw the template on top/below it

// calculates the x or y position of the template to be drawn
// size = width or height of the template/image
// anchor = the corresponding anchor config
function calculatePosition(scale, anchor, imageSize) {
  return imageSize * anchor.position / 100 - anchor.offset * scale;
}

function render(template, img, size, flipH) {
  let imgWidth = img.width;
  let imgHeight = img.height;
  if (size && size.height) {
    imgHeight = size.height;
    if (!size.width) imgWidth = imgWidth * size.height / img.height;
  }
  if (size && size.width) {
    imgWidth = size.width;
    if (!size.height) imgHeight = imgHeight * size.width / img.width;
  }

  const xScale = imgWidth / template.anchor.x.size;
  const yScale = imgHeight / template.anchor.y.size;
  const templateScale = Math.max(0, Math.min(10, Math.max(xScale || 0, yScale || 0)));
  console.log('templateScale', templateScale);


  let templateOffsetX = calculatePosition(templateScale, template.anchor.x, imgWidth);
  let templateOffsetY = calculatePosition(templateScale, template.anchor.y, imgHeight);

  let imageOffsetX = 0;
  let imageOffsetY = 0;
  let resultingWidth = imgWidth; // start with the image boundaries as defined by the image
  let resultingHeight = imgHeight;

  if (templateOffsetX < 0) {
    resultingWidth -= templateOffsetX;
    imageOffsetX = -templateOffsetX;
    templateOffsetX = 0;
  }
  if (templateOffsetY < 0) {
    resultingHeight -= templateOffsetY;
    imageOffsetY = -templateOffsetY;
    templateOffsetY = 0;
  }
  if (templateOffsetX + template.image.width * templateScale > resultingWidth) {
    resultingWidth = templateOffsetX + template.image.width * templateScale;
  }
  if (templateOffsetY + template.image.height * templateScale > resultingHeight) {
    resultingHeight = templateOffsetY + template.image.height * templateScale;
  }

  const toDraw = [{
    z: 1,
    image: img,
    x: flipH ? resultingWidth - imageOffsetX - imgWidth : imageOffsetX,
    y: imageOffsetY,
    h: imgHeight,
    w: imgWidth,
    name: 'image'
  }, {
    z: template.z || 0,
    image: template.image,
    x: templateOffsetX,
    y: templateOffsetY,
    h: template.image.height * templateScale,
    w: template.image.width * templateScale,
    name: `template ${template.src}`,
    flipH
  }].sort((u, v) => u.z > v.z);

  const canvas = new Canvas(resultingWidth, resultingHeight);
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < toDraw.length; ++i) {
    const subject = toDraw[i];
    console.log(`Drawing ${subject.name}${subject.flipH ? ' (flipped)' : ''}`);
    try {
      if (subject.flipH) {
        ctx.save();
        ctx.translate(resultingWidth, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(subject.image, subject.x, subject.y, subject.w, subject.h);
      if (subject.flipH) {
        ctx.restore();
      }
    } catch (err) {
      console.error(err);
      throw new Error(JSON.stringify({ status: 400, error: 'Invalid template' }));
    }
  }

  // return the image and cache it
  return (canvas);
}

app.get('/:templateName/', async (req, res) => {
  if (!templates[req.params.templateName]) return res.status(404).end();
  try {
    const canvas = render(templates[req.params.templateName], await loadImage(req.query.url));
    console.log(canvas);
    res.setHeader('Content-Type', 'image/png');
    return canvas.pngStream().pipe(res);
  } catch (err) {
    console.log(err);
    return res.status(400).end(err.message);
  }
});

app.listen(3002, () => {
  console.log('Beebot app listening on port 3002!');
});


// Discord stuff


const client = new Discord.Client({
  autoReconnect: true
});

const invitelink = `https://discordapp.com/oauth2/authorize?client_id=${config.discord.client_id}&scope=bot&permissions=0`;
console.log(`Bot invite link: ${invitelink}`);

client.login(config.discord.token).catch(error => {
  if (error) {
    console.error("Couldn't login: ", error);
    process.exit(15);
  }
});

function findEmoji(str) {
  const discordEmote = /<(a?):(\w+):(\d+)>/g.exec(str);
  if (discordEmote) {
    const animated = discordEmote[1] === 'a';
    const ext = animated ? 'gif' : 'png';
    return {
      animated,
      name: discordEmote[2],
      id: discordEmote[3],
      url: `https://cdn.discordapp.com/emojis/${discordEmote[2]}.${ext}`
    };
  }

  let unicodeEmoji;
  twemoji.parse(str, (name, emoji) => {
    if (unicodeEmoji) return false;
    unicodeEmoji = {
      animated: false,
      name,
      id: name,
      url: `${emoji.base + emoji.size}/${name}${emoji.ext}`
    };
    return false;
  });
  return unicodeEmoji;
}

function reverseString(str) {
  return str.split('').reverse().join('');
}

const commands = Object.keys(templates).map(x => `/${x}`).join(', ');
const otherCommands = {
  invite: `Invite link: <${invitelink}>`,
  help: `Available commands: ${commands}.\nUse \\\\<command> to flip the template horizontally.\nInvite link: <${invitelink}>`,
  beebot: `Available commands: ${commands}.\nUse \\\\<command> to flip the template horizontally.\nInvite link: <${invitelink}>`
};


client.on('message', async message => {
  console.log(`[${message.guild.name} - ${message.channel.name}] ${message.author.username}#${message.author.discriminator}: ${message.cleanContent}`);

  let commandParsed = /^([\/\\])(\w+)\b/.exec(message.cleanContent);
  if (commandParsed) {
    const [, direction, command] = commandParsed;
    if (otherCommands[command]) {
      const text = otherCommands[command];
      message.channel.send(direction === '\\' ? reverseString(text) : text);
      return;
    }
  }

  const messageSplit = message.cleanContent.split(' ');
  const emoji = findEmoji(message.cleanContent);
  let result = null;
  let count = 0;
  try {
    if (emoji) {
      let name = emoji.name;
      for (let i = 0; i < messageSplit.length && count < 4; ++i) {
        commandParsed = /^([\/\\])(\w+)\b/.exec(messageSplit[i]);
        if (commandParsed) {
          const [, direction, command] = commandParsed;
          console.log('Got command ', direction, command, direction === '\\' ? 'flipped' : 'not flipped');
          if (templates[command]) {
            count++;
            name += command;
            if (result === null) result = await loadImage(emoji.url);
            const templateData = templates[command];
            all(templateData, template => {
              result = render(template, result, null, direction === '\\');
            });
          }
        } else if (i === 0) return;
      }
      if (result) {
        const messageOptions = {
          files: [
            { attachment: result.toBuffer(), name: `${name}.png` }
          ]
        };
        message.channel.send('', messageOptions);
      }
    }
  } catch (err) {
    console.error(err);
  }
});
