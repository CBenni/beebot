const Canvas = require('canvas');
const express = require('express');
const neuquant = require('neuquant-js');
const _ = require('lodash');
const { GifWriter } = require('omggif');

const ImageEx = require('./ImageEx');

const { Image } = Canvas;
const app = express();

async function loadImage(url) {
  console.log(`Getting ${url}`);
}


function quantize(data, pixelNum) {
  const palette = [0, 0];
  const indexed = Buffer.alloc(pixelNum);

  for (let i = 0, k = 0; i < data.length; i += 4, k++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    const color = r << 16 | g << 8 | b << 0;

    const index = palette.indexOf(color);
    if (index === -1) {
      // console.log('New color ', r, g, b, a);
      if (palette.length < 256) {
        indexed[k] = palette.length;
        palette.push(color);
      } else {
        indexed[k] = 0;
      }
    } else {
      indexed[k] = index;
    }
  }
  // force palette to be power of 2

  let powof2 = 1;
  while (powof2 < palette.length) powof2 <<= 1;
  palette.length = powof2;

  return { indexed, palette };
}

function reduceRGB(palette) {
  const reducedPalette = [];
  for (let i = 0; i < palette.length; i += 3) {
    const r = palette[i];
    const g = palette[i + 1];
    const b = palette[i + 2];
    const color = r << 16 | g << 8 | b << 0;
    reducedPalette.push(color);
  }
  return reducedPalette;
}

app.get('/', async (req, res) => {
  try {
    const img = new ImageEx('https://cdn.discordapp.com/emojis/393660427541676042.gif');
    await img.init();


    const buffer = Buffer.alloc(img.width * img.height * img.frames.length * 5);
    const gif = new GifWriter(buffer, img.width, img.height, { background: 0 });

    const canvas = new Canvas(128, 128);
    const ctx = canvas.getContext('2d');
    _.each(img.frames, frame => {
      // let { palette, indexed } = neuquant.quantize(frame.data, { netsize: 256, samplefac: 10 });
      // palette = reduceRGB(palette);
      const { palette, indexed } = quantize(frame.data, img.width * img.height);
      // console.log('Palette: ', palette);
      // console.log('Palette length: ', palette.length);
      // console.log('Indexed: ', indexed);
      gif.addFrame(0, 0, img.width, img.height, indexed, {
        delay: frame.delay,
        palette
      });
    });
    console.log('Done rendering!');
    // img.draw(ctx, 220, 0, 0);
    res.setHeader('Content-Type', 'image/gif');
    return res.end(buffer.slice(0, gif.end()));
    // return canvas.pngStream().pipe(res);
  } catch (err) {
    console.log(err);
    return res.status(400).end(err.message);
  }
});

app.listen(3003, () => {
  console.log('Giftest app listening on port 3002!');
});
