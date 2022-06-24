(function (indexFactory, moduleCFactory) {
  var moduleCExports = moduleCFactory();
  return indexFactory(moduleCExports);
})(
  function indexFactory(moduleC) {
    var gl = moduleC;
    const $ = document.querySelector.bind(document);
    const canvas = $("canvas");
    const submitButton = $("input[type='submit']");
    const volumeSlider = $("input#volume");
    const audioCtx = new AudioContext();
    const audioElement = new Audio();
    let gainNode = null;
    const signalBuffers = [null, null];
    const analysers = [null, null];
    let playing = false;
    let paused = false;
    let lastGain = null;
    let pauseTime = null;
    let pauseWorker = null;

    function wrapThrowing(fn) {
      return (...args) => {
        try {
          fn(...args);
        } catch (err) {
          console.log("uncaught err:", err);
          alert(err);

          try {
            onStopPlaying();
          } catch (_) {}
        }
      };
    }

    function main() {
      $("form").addEventListener("submit", wrapThrowing(onSubmit));
      volumeSlider.addEventListener("input", wrapThrowing(onSetVolume));
      $("button#playPause").addEventListener(
        "click",
        wrapThrowing(onTogglePause)
      );
      $("button#stop").addEventListener("click", wrapThrowing(onStopPlaying));
      audioElement.addEventListener("canplay", wrapThrowing(onCanPlay));
      audioElement.addEventListener("ended", wrapThrowing(onStopPlaying));
      window.addEventListener("resize", wrapThrowing(onResize));
      window.addEventListener("keydown", wrapThrowing(onKey));
      window.addEventListener("keyup", wrapThrowing(onKey));
      window.addEventListener("click", wrapThrowing(onClick));

      audioSetup();

      volumeSlider.value = volumeSlider.max / 2;
      onSetVolume();

      gl.init(canvas);
      onResize();
      defaultPrepare();
      render(0);
    }

    document.addEventListener("DOMContentLoaded", wrapThrowing(main));

    function prepare(
      fftSize,
      pointSize,
      pointColor,
      fadeRate,
      flipX,
      flipY,
      drawLines
    ) {
      signalBuffers[0] = new Float32Array(fftSize);
      signalBuffers[1] = new Float32Array(fftSize);

      gl.prepare(
        fftSize,
        pointSize,
        pointColor,
        fadeRate,
        flipX,
        flipY,
        drawLines
      );
    }

    function defaultPrepare() {
      prepare(256, 5, [1, 0, 1], 0.01, false, false, false);
    }

    function onResize() {
      const viewportSize = Math.min(window.innerWidth, window.innerHeight);
      canvas.width = canvas.height = viewportSize;

      gl.resize(viewportSize);
    }

    function onSubmit(event) {
      event.preventDefault();
      const fields = event.target.elements;

      if (fields.file.files.length != 1) throw new Error("One file please");

      submitButton.disabled = true;

      const fftSize = parseInt(fields.fftSize.value);
      analysers[0].fftSize = analysers[1].fftSize = fftSize;

      const pointSize = parseFloat(fields.pointSize.value);
      const fadeRate = parseFloat(fields.fadeRate.value);

      if (pointSize === NaN || fadeRate === NaN)
        throw new Error("that ain't no number I ever heard of!");

      if (pointSize < 1)
        throw new Error("ain't nothin' gonna show with points that small!");

      if (fadeRate <= 0 || fadeRate > 1)
        throw new Error("that fade rate ain't gonna work fam");

      prepare(
        fftSize,
        pointSize,
        parseColor(fields.color.value),
        fadeRate,
        fields.flipX.checked,
        fields.flipY.checked,
        fields.drawMode.value === "lines"
      );

      const fileURL = URL.createObjectURL(fields.file.files[0]);

      audioElement.src = fileURL;

      audioElement.addEventListener(
        "canplay",
        () => URL.revokeObjectURL(fileURL),
        { once: true }
      );

      audioElement.addEventListener("error", onError, { once: true });

      if (audioCtx.currentTime === 0) audioCtx.resume();
    }

    function parseColor(hexstr) {
      if (hexstr.length != 6) throw new Error("invalid color");

      const res = [
        parseInt(hexstr.slice(0, 2), 16),
        parseInt(hexstr.slice(2, 4), 16),
        parseInt(hexstr.slice(4, 6), 16),
      ];

      if (res.some((v) => v === NaN)) throw new Error("invalid color");

      return res.map((v) => v / 255);
    }

    function onCanPlay() {
      document.documentElement.classList.add("playing");
      audioElement.play();

      playing = true;
    }

    function onError() {
      alert(
        "are you sure that's an audio file? your browser doesn't seem to think so"
      );
      onStopPlaying();
    }

    function onStopPlaying() {
      if (audioElement.src === "") return;

      audioElement.removeEventListener("error", onError);
      audioElement.pause();

      audioElement.src = "";
      document.documentElement.classList.remove("playing");
      submitButton.disabled = false;

      defaultPrepare();

      paused = false;
      if (lastGain !== null) resetPause();

      playing = false;
    }

    function resetPause() {
      clearInterval(pauseWorker);
      pauseWorker = null;
      pauseTime = null;
      gainNode.gain.value = lastGain;
      lastGain = null;
      onSetVolume();
    }

    function onTogglePause() {
      if (!playing) return;

      paused = !paused;

      if (paused) {
        lastGain = gainNode.gain.value;
        gainNode.gain.value = 0;

        pauseTime = audioElement.currentTime;
        pauseWorker = setInterval(
          () => (audioElement.currentTime = pauseTime),
          100
        );
      } else resetPause();
    }

    function onSetVolume() {
      const volMax = 1000;
      const val = volumeSlider.value / volMax;

      if (paused) {
        lastGain = val;
        return;
      } else gainNode.gain.value = val;
    }

    let shiftKeyHeld = false;

    function onKey(event) {
      if (event.target !== document.body) return;

      shiftKeyHeld = event.shiftKey;
    }

    function onClick(event) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLButtonElement ||
        !shiftKeyHeld ||
        !playing
      )
        return;

      const px = event.clientX / window.innerWidth;
      const dest = audioElement.duration * px;
      if (paused) pauseTime = dest;
      else audioElement.fastSeek(dest);
    }

    function audioSetup() {
      const audioSrc = audioCtx.createMediaElementSource(audioElement);
      const splitter = audioCtx.createChannelSplitter(2);
      const merger = audioCtx.createChannelMerger(2);
      const analyserLeft = (analysers[0] = audioCtx.createAnalyser());
      const analyserRight = (analysers[1] = audioCtx.createAnalyser());
      gainNode = audioCtx.createGain();

      audioSrc.connect(splitter);
      splitter.connect(analyserLeft, 0);
      splitter.connect(analyserRight, 1);
      analyserLeft.connect(merger, 0, 0);
      analyserRight.connect(merger, 0, 1);
      merger.connect(gainNode);
      gainNode.connect(audioCtx.destination);
    }

    function render(now) {
      now /= 1000;

      if (!playing && Math.random() < 0.15)
        for (let buf of signalBuffers)
          for (let i in buf) buf[i] = Math.random() * 2 - 1;
      else if (playing) {
        analysers[0].getFloatTimeDomainData(signalBuffers[0]);
        analysers[1].getFloatTimeDomainData(signalBuffers[1]);
      }

      gl.render(now, signalBuffers);
      requestAnimationFrame(render);
    }
    return {};
  },
  function moduleCFactory() {
    const floatSizeof = Float32Array.BYTES_PER_ELEMENT;

    let gl = null;

    let fftSize = null;
    let rightChannelOffset = 0;
    let drawLines = false;

    let samplesBuf;
    let quadBuf;

    let pointProg;
    let pointLayout;

    let quadProg;
    let quadLayout;
    let readTex, writeTex;
    let framebuffer;

    function init(canvas) {
      gl = canvas.getContext("webgl2", {
        alpha: true,
        depth: false,
        stencil: false,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        desyncrhonized: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: "high-performance",
      });
      window.gl = gl;

      if (gl === null)
        throw new Error(
          "Could not create WebGL context, does your device support WebGL 2?"
        );

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 1);

      samplesBuf = new Buffer();
      quadBuf = new Buffer();

      quadBuf.setData(
        Float32Array.of(
          -1.0,
          +1.0,
          0.0,
          1.0,
          +1.0,
          +1.0,
          1.0,
          1.0,
          -1.0,
          -1.0,
          0.0,
          0.0,
          +1.0,
          -1.0,
          1.0,
          0.0
        )
      );

      pointProg = new Program("point-vs", "point-fs", [
        "pointSize",
        "pointColor",
        "flipX",
        "flipY",
      ]);

      quadProg = new Program("quad-vs", "quad-fs", ["fadeRate", "tex"]);
      quadLayout = new VertexAttrLayout({
        pos: {
          buffer: quadBuf,
          size: 2,
          type: gl.FLOAT,
          stride: 4 * floatSizeof,
        },
        uv: {
          buffer: quadBuf,
          size: 2,
          type: gl.FLOAT,
          offset: 2 * floatSizeof,
          stride: 4 * floatSizeof,
        },
      });

      quadProg.use();
      gl.uniform1i(quadProg.uniforms.tex, 0);
      quadProg.unuse();

      writeTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, writeTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        writeTex,
        0
      );

      readTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }

    function prepare(
      _fftSize,
      pointSize,
      pointColor,
      fadeRate,
      flipX,
      flipY,
      _drawLines
    ) {
      fftSize = _fftSize;
      drawLines = _drawLines;

      let bufSize = floatSizeof * fftSize * 2;
      const halfSize = floatSizeof * fftSize;

      const align = floatSizeof;
      const alignOffset =
        halfSize % align === 0 ? 0 : align - (halfSize % align);
      bufSize += alignOffset;
      rightChannelOffset = halfSize + alignOffset;

      samplesBuf.setSized(bufSize, gl.STREAM_DRAW);

      pointLayout = new VertexAttrLayout({
        x: {
          buffer: samplesBuf,
          size: 1,
          type: gl.FLOAT,
        },
        y: {
          buffer: samplesBuf,
          size: 1,
          type: gl.FLOAT,
          offset: rightChannelOffset,
        },
      });

      pointProg.use();
      gl.uniform1f(pointProg.uniforms.pointSize, pointSize);
      gl.uniform3f(pointProg.uniforms.pointColor, ...pointColor);
      gl.uniform1f(pointProg.uniforms.flipX, flipX);
      gl.uniform1f(pointProg.uniforms.flipY, flipY);
      pointProg.unuse();

      quadProg.use();
      gl.uniform1f(quadProg.uniforms.fadeRate, fadeRate);
      quadProg.unuse();

      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    function resize(viewportSize) {
      gl.viewport(0, 0, viewportSize, viewportSize);

      const zeros = new Uint8Array(viewportSize ** 2 * 4);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        viewportSize,
        viewportSize,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        zeros
      );
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, writeTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        viewportSize,
        viewportSize,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        zeros
      );

      gl.activeTexture(gl.TEXTURE0);
    }

    function render(now, [chanLeft, chanRight]) {
      samplesBuf.setSubData(chanLeft, 0);
      samplesBuf.setSubData(chanRight, rightChannelOffset);

      pointProg.use();
      pointLayout.use();
      gl.drawArrays(drawLines ? gl.LINE_STRIP : gl.POINTS, 0, fftSize);
      pointLayout.unuse();
      pointProg.unuse();

      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(
        0,
        0,
        gl.canvas.width,
        gl.canvas.height,
        0,
        0,
        gl.canvas.width,
        gl.canvas.height,
        gl.COLOR_BUFFER_BIT,
        gl.LINEAR
      );

      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.copyTexImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGB,
        0,
        0,
        gl.canvas.width,
        gl.canvas.height,
        0
      );
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);

      quadProg.use();
      quadLayout.use();
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      quadLayout.unuse();
      quadProg.unuse();
    }

    class Program {
      constructor(vsID, fsID, uniforms = [], uniformBlocks = {}) {
        const vs = this.constructor._compileShader(vsID, gl.VERTEX_SHADER);
        const fs = this.constructor._compileShader(fsID, gl.FRAGMENT_SHADER);
        const prog = (this.handle = gl.createProgram());

        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.validateProgram(prog);

        if (
          !gl.getProgramParameter(prog, gl.LINK_STATUS) ||
          !gl.getProgramParameter(prog, gl.VALIDATE_STATUS)
        )
          throw new Error(
            `Program with shaders ${vsID}, ${fsID} failed to link or validate: ${gl.getProgramInfoLog(
              prog
            )}`
          );

        this.uniforms = {};

        for (const name of uniforms)
          this.uniforms[name] = gl.getUniformLocation(prog, name);

        for (const blockName in uniformBlocks) {
          const binding = uniformBlocks[blockName];
          const index = gl.getUniformBlockIndex(prog, blockName);

          if (index != gl.INVALID_INDEX)
            gl.uniformBlockBinding(prog, index, binding);
          else
            console.warn(
              `Invalid index for uniform block ${blockName} on for program ${vsID}, ${fsID}`
            );
        }
      }

      static _compileShader(id, type) {
        const script = document.querySelector(`script#${id}`);

        if (script === null)
          throw new Error(`script tag with id ${id} not found`);

        const shader = gl.createShader(type);
        gl.shaderSource(shader, script.textContent);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(
            `Failed to compile shader ${id}: ${gl.getShaderInfoLog(shader)}`
          );

        return shader;
      }

      use() {
        gl.useProgram(this.handle);
      }

      unuse() {
        gl.useProgram(null);
      }
    }

    const _defaultBufferUsageHint = 0x88e4;
    const _bufferScratchTarget = 0x88ec;

    class Buffer {
      constructor() {
        this.handle = gl.createBuffer();
        this.boundTarget = null;
      }

      length() {
        gl.bindBuffer(_bufferScratchTarget, this.handle);
        const len = gl.getBufferParameter(_bufferScratchTarget, gl.BUFFER_SIZE);
        gl.bindBuffer(_bufferScratchTarget, null);
        return len;
      }

      use(target) {
        gl.bindBuffer(target, this.handle);
        this.boundTarget = target;
      }

      unuse() {
        if (this.boundTarget == null) return;
        gl.bindBuffer(this.boundTarget, null);
        this.boundTarget = null;
      }

      useIndexed(target, index, offset = 0, size = 0) {
        if (size == 0) size = this.length();
        gl.bindBufferRange(target, index, this.handle, offset, size);
      }

      setSized(size, usage = _defaultBufferUsageHint) {
        gl.bindBuffer(_bufferScratchTarget, this.handle);
        gl.bufferData(_bufferScratchTarget, size, usage);
        gl.bindBuffer(_bufferScratchTarget, null);
      }

      setData(buf, usage = _defaultBufferUsageHint) {
        gl.bindBuffer(_bufferScratchTarget, this.handle);
        gl.bufferData(_bufferScratchTarget, buf, usage);
        gl.bindBuffer(_bufferScratchTarget, null);
      }

      setSubData(buf, offset) {
        gl.bindBuffer(_bufferScratchTarget, this.handle);
        const length = gl.getBufferParameter(
          _bufferScratchTarget,
          gl.BUFFER_SIZE
        );

        if (buf.length > length - offset)
          throw new Error(
            `setSubData buffer overflow: trying to write buffer of length ${
              buf.length
            } at ${offset} into buffer of size ${length} (only have ${
              length - offset
            })`
          );

        gl.bufferSubData(_bufferScratchTarget, offset, buf);
        gl.bindBuffer(_bufferScratchTarget, null);
      }
    }

    class VertexAttrLayout {
      constructor(layout) {
        let index = 0;
        this.handle = gl.createVertexArray();
        this.use();

        for (const attrName in layout) {
          const { buffer, size, type } = layout[attrName];
          const normalizeInts = layout[attrName]["normalizeInts"] || false;
          const stride = layout[attrName]["stride"] || 0;
          const offset = layout[attrName]["offset"] || 0;
          const divisor = layout[attrName]["divisor"] || 0;

          buffer.use(gl.ARRAY_BUFFER);
          gl.enableVertexAttribArray(index);
          gl.vertexAttribPointer(
            index,
            size,
            type,
            normalizeInts,
            stride,
            offset
          );
          gl.vertexAttribDivisor(index, divisor);
          buffer.unuse();

          index += 1;
        }

        this.unuse();
      }

      use() {
        gl.bindVertexArray(this.handle);
      }

      unuse() {
        gl.bindVertexArray(null);
      }
    }
    return { init: init, prepare: prepare, resize: resize, render: render };
  }
);