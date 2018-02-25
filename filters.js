const _ = require('lodash');
const Canvas = require('canvas');
const { _drawImage } = require('./imageex');

const { createCanvas, Image } = Canvas;

const filters = {
  pride: (canvas, source, x, y, props) => {
    _.each(canvas.frames, frame => {
      const tmpCanvas = createCanvas(frame.canvas.width, frame.canvas.height);
      const tmpCtx = tmpCanvas.getContext('2d');
      _drawImage(tmpCtx, frame.canvas, x, y, props);
      const multiplyProps = _.extend({}, props, { attributes: { globalCompositeOperation: 'multiply' } });
      _drawImage(tmpCtx, source.frames[0].canvas, x, y, multiplyProps);


      const tmpCanvas2 = createCanvas(frame.canvas.width, frame.canvas.height);
      const tmpCtx2 = tmpCanvas2.getContext('2d');
      _drawImage(tmpCtx2, frame.canvas, x, y, props);
      const sourceInProps = _.extend({}, props, { attributes: { globalCompositeOperation: 'source-in' } });
      _drawImage(tmpCtx2, source.frames[0].canvas, x, y, sourceInProps);

      const combineProps2 = _.extend({}, props, { attributes: { globalCompositeOperation: 'source-atop', globalAlpha: 0.9 } });
      _drawImage(frame.ctx, tmpCanvas2, x, y, combineProps2);
      const combineProps = _.extend({}, props, { attributes: { globalCompositeOperation: 'source-atop', globalAlpha: 0.8 } });
      _drawImage(frame.ctx, tmpCanvas, x, y, combineProps);
    });
    return canvas;
  }
};
module.exports = filters;
