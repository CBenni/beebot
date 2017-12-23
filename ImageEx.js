const { GifReader } = require('omggif');
const got = require('got');
const Canvas = require('canvas');

const { Image } = Canvas;


class ImageEx {
  constructor(src) {
    this.src = src;
    this.frameInfos = null;
  }

  async init() {
    const res = await got(this.src, { encoding: null });
    this.type = res.headers['content-type'];
    this.data = res.body;
    console.log('Loading ', this.type);
    if (this.type === 'image/gif') {
      this.loadGif();
    } else {
      this.loadStatic();
    }
  }

  loadGif() {
    this.frames = [];
    this.totalLength = null;
    this.currentFrame = 0;

    this.waiting = [];
    // load the gif
    const decoder = new GifReader(this.data);
    this.width = decoder.width;
    this.height = decoder.height;
    const len = decoder.numFrames();
    this.frames = [];
    let offset = 0;
    const framedata = Buffer.alloc(4 * decoder.width * decoder.height);

    const pixels = decoder.width * decoder.height;
    let lastdisposal = 0;
    let mask;
    for (let i = 0; i < len; ++i) {
      // build the frame info
      const frameinfo = decoder.frameInfo(i);
      let framedataCopy = null;
      // if disposal is 3, we backup the framedata
      if (frameinfo.disposal === 3) {
        framedataCopy = new Uint8ClampedArray(framedata.data.length);
      }

      // make a temporary canvas
      const tmpcanvas = new Canvas(decoder.width, decoder.height);
      const tmpctx = tmpcanvas.getContext('2d');
      // blit the imagedata to the temp canvas
      const tmpdata = tmpctx.getImageData(0, 0, decoder.width, decoder.height).data;
      decoder.decodeAndBlitFrameRGBA(i, tmpdata); // Decode frame
      // iterate over all the pixels
      for (let j = 0; j < pixels; ++j) {
        // apply mask if the disposal method was 2
        if (lastdisposal === 2) {
          // get the alpha value
          const alpha = mask[j * 4 + 3];
          if (alpha > 0) {
            // clear the pixel
            framedata[j * 4] = 0;
            framedata[j * 4 + 1] = 0;
            framedata[j * 4 + 2] = 0;
            framedata[j * 4 + 3] = 0;
          }
        }
        // draw the new pixel
        // get the alpha value
        const alpha = tmpdata[j * 4 + 3];
        if (alpha > 0) {
          // set the pixel
          framedata[j * 4] = tmpdata[j * 4];
          framedata[j * 4 + 1] = tmpdata[j * 4 + 1];
          framedata[j * 4 + 2] = tmpdata[j * 4 + 2];
          framedata[j * 4 + 3] = tmpdata[j * 4 + 3];
        }
      }

      // draw the framedata to the framecanvas and get the data url
      frameinfo.data = Buffer.from(framedata);
      const frameimg = new Image();
      frameimg.src = framedata;

      frameinfo.offset = offset;
      offset += frameinfo.delay;
      frameinfo.end = offset;
      frameinfo.img = frameimg;
      lastdisposal = frameinfo.disposal;
      if (frameinfo.disposal === 2) {
        // store the mask
        mask = tmpdata;
      } else if (frameinfo.disposal === 3) {
        framedata.set(framedataCopy);
      }

      this.frames.push(frameinfo);
    }

    this.totalLength = offset;
  }

  loadStatic() {
    const tmpimg = new Image();
    tmpimg.src = this.data;

    this.width = tmpimg.width;
    this.height = tmpimg.height;
    this.frames = [{
      offset: 0, duration: Infinity, end: Infinity, img: tmpimg
    }];
    this.totalLength = Infinity;
  }

  draw(targetContext, frameNum, x, y, w, h) {
    const frame = this.frames[frameNum];
    if (!frame) throw new Error(`Frame #${frameNum} not found!`);
    targetContext.drawImage(frame.img, x, y, w || this.width, h || this.height);
  }
}

module.exports = ImageEx;
/*
const __drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (image, xpos, ypos, width, height) {
  if (image instanceof ImageEx) {
    image.draw(this, xpos, ypos, width, height);
  } else {
    __drawImage.apply(this, arguments);
  }
};
*/
