
// Generic functions
function bitsToNum(ba) {
  return ba.reduce((s, n) => s * 2 + n, 0);
}

function byteToBitArr(bite) {
  const a = [];
  for (let i = 7; i >= 0; i--) {
    a.push(!!(bite & (1 << i)));
  }
  return a;
}

class Stream {
  constructor(data) {
    this.data = data;
    this.len = this.data.length;
    this.pos = 0;

    this.readByte = () => {
      if (this.pos >= this.data.length) {
        throw new Error('Attempted to read past end of stream.');
      }
      if (data instanceof Uint8Array) { return data[this.pos++]; }
      return data.charCodeAt(this.pos++) & 0xFF;
    };

    this.readBytes = n => {
      const bytes = [];
      for (let i = 0; i < n; i++) {
        bytes.push(this.readByte());
      }
      return bytes;
    };

    this.read = n => {
      let s = '';
      for (let i = 0; i < n; i++) {
        s += String.fromCharCode(this.readByte());
      }
      return s;
    };

    this.readUnsigned = () => {
      const a = this.readBytes(2);
      return (a[1] << 8) + a[0];
    };
  }
}

function lzwDecode(minCodeSize, data) {
  // TODO: Now that the GIF parser is a bit different, maybe this should get an array of bytes instead of a String?
  let pos = 0; // Maybe this streaming thing should be merged with the Stream?
  const readCode = size => {
    let code = 0;
    for (let i = 0; i < size; i++) {
      if (data.charCodeAt(pos >> 3) & (1 << (pos & 7))) {
        code |= 1 << i;
      }
      pos++;
    }
    return code;
  };

  const output = [];

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let codeSize = minCodeSize + 1;

  let dict = [];

  const clear = () => {
    dict = [];
    codeSize = minCodeSize + 1;
    for (let i = 0; i < clearCode; i++) {
      dict[i] = [i];
    }
    dict[clearCode] = [];
    dict[eoiCode] = null;
  };

  let code;
  let last;

  while (true) {
    last = code;
    code = readCode(codeSize);

    if (code === clearCode) {
      clear();
      continue;
    }
    if (code === eoiCode) break;

    if (code < dict.length) {
      if (last !== clearCode) {
        dict.push(dict[last].concat(dict[code][0]));
      }
    } else {
      if (code !== dict.length) throw new Error('Invalid LZW code.');
      dict.push(dict[last].concat(dict[last][0]));
    }
    output.push(...dict[code]);

    if (dict.length === (1 << codeSize) && codeSize < 12) {
      // If we're at the last code and codeSize is 12, the next code will be a clearCode, and it'll be 12 bits long.
      codeSize++;
    }
  }

  // I don't know if this is technically an error, but some GIFs do it.
  // if (Math.ceil(pos / 8) !== data.length) throw new Error('Extraneous LZW bytes.');
  return output;
}


// The actual parsing; returns an object with properties.
function parseGIF(st, handler) {
  handler = handler || {};

  // LZW (GIF-specific)
  const parseCT = entries => { // Each entry is 3 bytes, for RGB.
    const ct = [];
    for (let i = 0; i < entries; i++) {
      ct.push(st.readBytes(3));
    }
    return ct;
  };

  const readSubBlocks = () => {
    let size;
    let data;
    data = '';
    do {
      size = st.readByte();
      data += st.read(size);
    } while (size !== 0);
    return data;
  };

  const parseHeader = () => {
    const hdr = {};
    hdr.sig = st.read(3);
    hdr.ver = st.read(3);
    if (hdr.sig !== 'GIF') throw new Error('Not a GIF file.'); // XXX: This should probably be handled more nicely.
    hdr.width = st.readUnsigned();
    hdr.height = st.readUnsigned();

    const bits = byteToBitArr(st.readByte());
    hdr.gctFlag = bits.shift();
    hdr.colorRes = bitsToNum(bits.splice(0, 3));
    hdr.sorted = bits.shift();
    hdr.gctSize = bitsToNum(bits.splice(0, 3));

    hdr.bgColor = st.readByte();
    hdr.pixelAspectRatio = st.readByte(); // if not 0, aspectRatio = (pixelAspectRatio + 15) / 64
    if (hdr.gctFlag) {
      hdr.gct = parseCT(1 << (hdr.gctSize + 1));
    }
    handler.hdr && handler.hdr(hdr); // eslint-disable-line no-unused-expressions
  };

  const parseExt = block => {
    const parseGCExt = innerblock => {
      st.readByte(); // Always 4
      const bits = byteToBitArr(st.readByte());
      innerblock.reserved = bits.splice(0, 3); // Reserved; should be 000.
      innerblock.disposalMethod = bitsToNum(bits.splice(0, 3));
      innerblock.userInput = bits.shift();
      innerblock.transparencyGiven = bits.shift();

      innerblock.delayTime = st.readUnsigned();

      innerblock.transparencyIndex = st.readByte();

      innerblock.terminator = st.readByte();

      handler.gce && handler.gce(innerblock); // eslint-disable-line no-unused-expressions
    };

    const parseComExt = innerblock => {
      innerblock.comment = readSubBlocks();
      handler.com && handler.com(innerblock);
    };

    const parsePTExt = innerblock => {
      // No one *ever* uses this. If you use it, deal with parsing it yourself.
      st.readByte(); // Always 12
      innerblock.ptHeader = st.readBytes(12);
      innerblock.ptData = readSubBlocks();
      handler.pte && handler.pte(innerblock);
    };

    const parseAppExt = innerblock => {
      const parseNetscapeExt = subblock => {
        st.readByte(); // Always 3
        subblock.unknown = st.readByte(); // ??? Always 1? What is this?
        subblock.iterations = st.readUnsigned();
        subblock.terminator = st.readByte();
        handler.app && handler.app.NETSCAPE && handler.app.NETSCAPE(subblock);
      };

      const parseUnknownAppExt = subblock => {
        subblock.appData = readSubBlocks();
        // FIXME: This won't work if a handler wants to match on any identifier.
        handler.app && handler.app[subblock.identifier] && handler.app[subblock.identifier](subblock);
      };

      st.readByte(); // Always 11
      block.identifier = st.read(8);
      block.authCode = st.read(3);
      switch (innerblock.identifier) {
        case 'NETSCAPE':
          parseNetscapeExt(innerblock);
          break;
        default:
          parseUnknownAppExt(innerblock);
          break;
      }
    };

    const parseUnknownExt = innerblock => {
      innerblock.data = readSubBlocks();
      handler.unknown && handler.unknown(innerblock);
    };

    block.label = st.readByte();
    switch (block.label) {
      case 0xF9:
        block.extType = 'gce';
        parseGCExt(block);
        break;
      case 0xFE:
        block.extType = 'com';
        parseComExt(block);
        break;
      case 0x01:
        block.extType = 'pte';
        parsePTExt(block);
        break;
      case 0xFF:
        block.extType = 'app';
        parseAppExt(block);
        break;
      default:
        block.extType = 'unknown';
        parseUnknownExt(block);
        break;
    }
  };

  const parseImg = img => {
    const deinterlace = (pixels, width) => {
      // Of course this defeats the purpose of interlacing. And it's *probably*
      // the least efficient way it's ever been implemented. But nevertheless...
      const newPixels = new Array(pixels.length);
      const rows = pixels.length / width;
      const cpRow = (toRow, fromRow) => {
        const fromPixels = pixels.slice(fromRow * width, (fromRow + 1) * width);
        newPixels.splice(...[toRow * width, width].concat(fromPixels));
      };

      // See appendix E.
      const offsets = [0, 4, 2, 1];
      const steps = [8, 8, 4, 2];

      let fromRow = 0;
      for (let pass = 0; pass < 4; pass++) {
        for (let toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
          cpRow(toRow, fromRow);
          fromRow++;
        }
      }

      return newPixels;
    };

    img.leftPos = st.readUnsigned();
    img.topPos = st.readUnsigned();
    img.width = st.readUnsigned();
    img.height = st.readUnsigned();

    const bits = byteToBitArr(st.readByte());
    img.lctFlag = bits.shift();
    img.interlaced = bits.shift();
    img.sorted = bits.shift();
    img.reserved = bits.splice(0, 2);
    img.lctSize = bitsToNum(bits.splice(0, 3));

    if (img.lctFlag) {
      img.lct = parseCT(1 << (img.lctSize + 1));
    }

    img.lzwMinCodeSize = st.readByte();

    const lzwData = readSubBlocks();

    img.pixels = lzwDecode(img.lzwMinCodeSize, lzwData);

    if (img.interlaced) { // Move
      img.pixels = deinterlace(img.pixels, img.width);
    }

    handler.img && handler.img(img);
  };

  const parseBlock = () => {
    const block = {};
    block.sentinel = st.readByte();

    switch (String.fromCharCode(block.sentinel)) { // For ease of matching
      case '!':
        block.type = 'ext';
        parseExt(block);
        break;
      case ',':
        block.type = 'img';
        parseImg(block);
        break;
      case ';':
        block.type = 'eof';
        handler.eof && handler.eof(block);
        break;
      default:
        throw new Error(`Unknown block: 0x${block.sentinel.toString(16)}`); // TODO: Pad this with a 0.
    }

    if (block.type !== 'eof') setTimeout(parseBlock, 0);
  };

  const parse = () => {
    parseHeader();
    setTimeout(parseBlock, 0);
  };

  parse();
}

class SuperGif {
  constructor(opts) {
    const options = {
    // viewport position
      vp_l: 0,
      vp_t: 0,
      vp_w: null,
      vp_h: null,
      // canvas sizes
      c_w: null,
      c_h: null
    };
    for (const i in opts) {
      if (Object.hasOwnProperty(opts, i)) options[i] = opts[i];
    }
    if (options.vp_w && options.vp_h) options.is_vp = true;

    let stream;
    let hdr;

    let loadError = null;
    let loading = false;

    let transparency = null;
    let delay = null;
    let disposalMethod = null;
    let disposalRestoreFromIdx = null;
    let lastDisposalMethod = null;
    let frame = null;
    let lastImg = null;

    let playing = true;
    const forward = true;

    let ctxScaled = false;

    let frames = [];
    const frameOffsets = []; // elements have .x and .y properties

    const gif = options.gif;

    const onEndListener = (options.hasOwnProperty('on_end') ? options.on_end : null);
    const loopDelay = (options.hasOwnProperty('loop_delay') ? options.loop_delay : 0);
    const overrideLoopMode = (options.hasOwnProperty('loop_mode') ? options.loop_mode : 'auto');
    let drawWhileLoading = (options.hasOwnProperty('draw_while_loading') ? options.draw_while_loading : true);
    const showProgressBar = drawWhileLoading ? (options.hasOwnProperty('show_progress_bar') ? options.show_progress_bar : true) : false;
    const progressBarHeight = (options.hasOwnProperty('progressbar_height') ? options.progressbar_height : 25);
    const progressBarBackgroundColor = (options.hasOwnProperty('progressbar_background_color') ? options.progressbar_background_color : 'rgba(255,255,255,0.4)');
    const progressBarForegroundColor = (options.hasOwnProperty('progressbar_foreground_color') ? options.progressbar_foreground_color : 'rgba(255,0,22,.8)');

    const clear = () => {
      transparency = null;
      delay = null;
      lastDisposalMethod = disposalMethod;
      disposalMethod = null;
      frame = null;
    };

    // XXX: There's probably a better way to handle catching exceptions when
    // callbacks are involved.
    const doParse = () => {
      try {
        parseGIF(stream, handler);
      } catch (err) {
        doLoadError('parse');
      }
    };

    const doText = text => {
      toolbar.innerHTML = text; // innerText? Escaping? Whatever.
      toolbar.style.visibility = 'visible';
    };

    const setSizes = (w, h) => {
      canvas.width = w * get_canvas_scale();
      canvas.height = h * get_canvas_scale();
      toolbar.style.minWidth = `${w * get_canvas_scale()}px`;

      tmpCanvas.width = w;
      tmpCanvas.height = h;
      tmpCanvas.style.width = `${w}px`;
      tmpCanvas.style.height = `${h}px`;
      tmpCanvas.getContext('2d').setTransform(1, 0, 0, 1, 0, 0);
    };

    const setFrameOffset = (frame, offset) => {
      if (!frameOffsets[frame]) {
        frameOffsets[frame] = offset;
        return;
      }
      if (typeof offset.x !== 'undefined') {
        frameOffsets[frame].x = offset.x;
      }
      if (typeof offset.y !== 'undefined') {
        frameOffsets[frame].y = offset.y;
      }
    };

    const doShowProgress = (pos, length, draw) => {
      if (draw && showProgressBar) {
        let height = progressBarHeight;
        let left;
        let mid;
        let top;
        let width;
        if (options.is_vp) {
          if (!ctxScaled) {
            top = (options.vp_t + options.vp_h - height);
            left = options.vp_l;
            mid = left + (pos / length) * options.vp_w;
            width = canvas.width;
          } else {
            top = (options.vp_t + options.vp_h - height) / get_canvas_scale();
            height /= get_canvas_scale();
            left = (options.vp_l / get_canvas_scale());
            mid = left + (pos / length) * (options.vp_w / get_canvas_scale());
            width = canvas.width / get_canvas_scale();
          }
          // some debugging, draw rect around viewport
          if (false) {
            if (!ctxScaled) {
              var l = options.vp_l,
                t = options.vp_t;
              var w = options.vp_w,
                h = options.vp_h;
            } else {
              var l = options.vp_l / get_canvas_scale(),
                t = options.vp_t / get_canvas_scale();
              var w = options.vp_w / get_canvas_scale(),
                h = options.vp_h / get_canvas_scale();
            }
            ctx.rect(l, t, w, h);
            ctx.stroke();
          }
        } else {
          top = (canvas.height - height) / (ctxScaled ? get_canvas_scale() : 1);
          mid = ((pos / length) * canvas.width) / (ctxScaled ? get_canvas_scale() : 1);
          width = canvas.width / (ctxScaled ? get_canvas_scale() : 1);
          height /= ctxScaled ? get_canvas_scale() : 1;
        }

        ctx.fillStyle = progressBarBackgroundColor;
        ctx.fillRect(mid, top, width - mid, height);

        ctx.fillStyle = progressBarForegroundColor;
        ctx.fillRect(0, top, mid, height);
      }
    };

    const doLoadError = originOfError => {
      const drawError = () => {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, options.c_w ? options.c_w : hdr.width, options.c_h ? options.c_h : hdr.height);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 3;
        ctx.moveTo(0, 0);
        ctx.lineTo(options.c_w ? options.c_w : hdr.width, options.c_h ? options.c_h : hdr.height);
        ctx.moveTo(0, options.c_h ? options.c_h : hdr.height);
        ctx.lineTo(options.c_w ? options.c_w : hdr.width, 0);
        ctx.stroke();
      };

      loadError = originOfError;
      hdr = {
        width: gif.width,
        height: gif.height
      }; // Fake header.
      frames = [];
      drawError();
    };

    const doHdr = _hdr => {
      hdr = _hdr;
      setSizes(hdr.width, hdr.height);
    };

    const pushFrame = () => {
      if (!frame) return;
      frames.push({
        data: frame.getImageData(0, 0, hdr.width, hdr.height),
        delay
      });
      frameOffsets.push({ x: 0, y: 0 });
    };

    const doGCE = gce => {
      pushFrame();
      clear();
      transparency = gce.transparencyGiven ? gce.transparencyIndex : null;
      delay = gce.delayTime;
      disposalMethod = gce.disposalMethod;
    // We don't have much to do with the rest of GCE.
    };

    const doImg = img => {
      if (!frame) frame = tmpCanvas.getContext('2d');

      const currIdx = frames.length;

      // ct = color table, gct = global color table
      const ct = img.lctFlag ? img.lct : hdr.gct; // TODO: What if neither exists?

      /*
        Disposal method indicates the way in which the graphic is to
        be treated after being displayed.

        Values :    0 - No disposal specified. The decoder is
                        not required to take any action.
                    1 - Do not dispose. The graphic is to be left
                        in place.
                    2 - Restore to background color. The area used by the
                        graphic must be restored to the background color.
                    3 - Restore to previous. The decoder is required to
                        restore the area overwritten by the graphic with
                        what was there prior to rendering the graphic.

                        Importantly, "previous" means the frame state
                        after the last disposal of method 0, 1, or 2.
        */
      if (currIdx > 0) {
        if (lastDisposalMethod === 3) {
        // Restore to previous
        // If we disposed every frame including first frame up to this point, then we have
        // no composited frame to restore to. In this case, restore to background instead.
          if (disposalRestoreFromIdx !== null) {
            frame.putImageData(frames[disposalRestoreFromIdx].data, 0, 0);
          } else {
            frame.clearRect(lastImg.leftPos, lastImg.topPos, lastImg.width, lastImg.height);
          }
        } else {
          disposalRestoreFromIdx = currIdx - 1;
        }

        if (lastDisposalMethod === 2) {
        // Restore to background color
        // Browser implementations historically restore to transparent; we do the same.
        // http://www.wizards-toolkit.org/discourse-server/viewtopic.php?f=1&t=21172#p86079
          frame.clearRect(lastImg.leftPos, lastImg.topPos, lastImg.width, lastImg.height);
        }
      }
      // else, Undefined/Do not dispose.
      // frame contains final pixel data from the last frame; do nothing

      // Get existing pixels for img region after applying disposal method
      const imgData = frame.getImageData(img.leftPos, img.topPos, img.width, img.height);

      // apply color table colors
      img.pixels.forEach((pixel, i) => {
      // imgData.data === [R,G,B,A,R,G,B,A,...]
        if (pixel !== transparency) {
          imgData.data[i * 4 + 0] = ct[pixel][0];
          imgData.data[i * 4 + 1] = ct[pixel][1];
          imgData.data[i * 4 + 2] = ct[pixel][2];
          imgData.data[i * 4 + 3] = 255; // Opaque.
        }
      });

      frame.putImageData(imgData, img.leftPos, img.topPos);

      if (!ctxScaled) {
        ctx.scale(get_canvas_scale(), get_canvas_scale());
        ctxScaled = true;
      }

      // We could use the on-page canvas directly, except that we draw a progress
      // bar for each image chunk (not just the final image).
      if (drawWhileLoading) {
        ctx.drawImage(tmpCanvas, 0, 0);
        drawWhileLoading = options.auto_play;
      }

      lastImg = img;
    };

    const player = () => {
      let i = -1;
      let iterationCount = 0;

      const showingInfo = false;
      const pinned = false;

      /**
         * Gets the index of the frame "up next".
         * @returns {number}
         */
      const getNextFrameNo = () => {
        const delta = (forward ? 1 : -1);
        return (i + delta + frames.length) % frames.length;
      };

      const stepFrame = amount => { // XXX: Name is confusing.
        i += amount;

        putFrame();
      };

      const step = () => {
        let stepping = false;

        const completeLoop = () => {
          if (onEndListener !== null) { onEndListener(gif); }
          iterationCount++;

          if (overrideLoopMode !== false || iterationCount < 0) {
            doStep();
          } else {
            stepping = false;
            playing = false;
          }
        };

        const doStep = () => {
          stepping = playing;
          if (!stepping) return;

          stepFrame(1);
          let delay = frames[i].delay * 10;
          if (!delay) delay = 100; // FIXME: Should this even default at all? What should it be?

          const nextFrameNo = getNextFrameNo();
          if (nextFrameNo === 0) {
            delay += loopDelay;
            setTimeout(completeLoop, delay);
          } else {
            setTimeout(doStep, delay);
          }
        };

        return () => {
          if (!stepping) setTimeout(doStep, 0);
        };
      };

      const putFrame = () => {
        i = parseInt(i, 10);

        if (i > frames.length - 1) {
          i = 0;
        }

        if (i < 0) {
          i = 0;
        }

        const offset = frameOffsets[i];

        tmpCanvas.getContext('2d').putImageData(frames[i].data, offset.x, offset.y);
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(tmpCanvas, 0, 0);
      };

      const play = () => {
        playing = true;
        step();
      };

      const pause = () => {
        playing = false;
      };


      return {
        init() {
          if (loadError) return;

          if (!(options.c_w && options.c_h)) {
            ctx.scale(get_canvas_scale(), get_canvas_scale());
          }

          if (options.auto_play) {
            step();
          } else {
            i = 0;
            putFrame();
          }
        },
        step,
        play,
        pause,
        playing,
        move_relative: stepFrame,
        current_frame() { return i; },
        length() { return frames.length; },
        move_to(frame_idx) {
          i = frame_idx;
          putFrame();
        }
      };
    };

    const doDecodeProgress = draw => {
      doShowProgress(stream.pos, stream.data.length, draw);
    };

    const doNothing = () => { };
    /**
     * @param{boolean=} draw Whether to draw progress bar or not; this is not idempotent because of translucency.
     *                       Note that this means that the text will be unsynchronized with the progress bar on non-frames;
     *                       but those are typically so small (GCE etc.) that it doesn't really matter. TODO: Do this properly.
     */
    const withProgress = (fn, draw) => block => {
      fn(block);
      doDecodeProgress(draw);
    };


    const handler = {
      hdr: withProgress(doHdr),
      gce: withProgress(doGCE),
      com: withProgress(doNothing),
      // I guess that's all for now.
      app: {
      // TODO: Is there much point in actually supporting iterations?
        NETSCAPE: withProgress(doNothing)
      },
      img: withProgress(doImg, true),
      eof(block) {
      // toolbar.style.display = '';
        pushFrame();
        doDecodeProgress(false);
        if (!(options.c_w && options.c_h)) {
          canvas.width = hdr.width * get_canvas_scale();
          canvas.height = hdr.height * get_canvas_scale();
        }
        player.init();
        loading = false;
        if (load_callback) {
          load_callback(gif);
        }
      }
    };

    const init = () => {
      canvas = new Canvas(gif.width, gif.height);

      tmpCanvas = new Canvas(gif.width, gif.height);


      if (options.c_w && options.c_h) setSizes(options.c_w, options.c_h);
      initialized = true;
    };

    const get_canvas_scale = () => {
      let scale;
      if (options.max_width && hdr && hdr.width > options.max_width) {
        scale = options.max_width / hdr.width;
      } else {
        scale = 1;
      }
      return scale;
    };

    let canvas,
      ctx,
      toolbar,
      tmpCanvas;
    var initialized = false;
    var load_callback = false;

    const loadSetup = callback => {
      if (loading) return false;
      if (callback) load_callback = callback;
      else load_callback = false;

      loading = true;
      frames = [];
      clear();
      disposalRestoreFromIdx = null;
      lastDisposalMethod = null;
      frame = null;
      lastImg = null;

      return true;
    };

    return {
    // play controls
      play: player.play,
      pause: player.pause,
      move_relative: player.move_relative,
      move_to: player.move_to,

      // getters for instance vars
      get_playing() { return playing; },
      get_canvas() { return canvas; },
      get_canvas_scale() { return get_canvas_scale(); },
      get_loading() { return loading; },
      get_auto_play() { return options.auto_play; },
      get_length() { return player.length(); },
      get_current_frame() { return player.current_frame(); },
      load_url(src, callback) {
        if (!loadSetup(callback)) return;

        const h = new XMLHttpRequest();
        // new browsers (XMLHttpRequest2-compliant)
        h.open('GET', src, true);

        if ('overrideMimeType' in h) {
          h.overrideMimeType('text/plain; charset=x-user-defined');
        }

        // old browsers (XMLHttpRequest-compliant)
        else if ('responseType' in h) {
          h.responseType = 'arraybuffer';
        }

        // IE9 (Microsoft.XMLHTTP-compliant)
        else {
          h.setRequestHeader('Accept-Charset', 'x-user-defined');
        }

        h.onloadstart = () => {
        // Wait until connection is opened to replace the gif element with a canvas to avoid a blank img
          if (!initialized) init();
        };
        h.onload = () => {
          if (this.status !== 200) {
            doLoadError('xhr - response');
          }
          let data = this.response;
          if (data.toString().indexOf('ArrayBuffer') > 0) {
            data = new Uint8Array(data);
          }

          stream = new Stream(data);
          setTimeout(doParse, 0);
        };
        h.onprogress = e => {
          if (e.lengthComputable) doShowProgress(e.loaded, e.total, true);
        };
        h.onerror = function () { doLoadError('xhr'); };
        h.send();
      },
      load(callback) {
        this.load_url(gif.getAttribute('rel:animated_src') || gif.src, callback);
      },
      load_raw(arr, callback) {
        if (!loadSetup(callback)) return;
        if (!initialized) init();
        stream = new Stream(arr);
        setTimeout(doParse, 0);
      },
      set_frame_offset: setFrameOffset
    };
  }
}

module.exports = { SuperGif, parseGIF };
