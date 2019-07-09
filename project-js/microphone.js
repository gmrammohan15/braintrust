/* vim: sw=2 ts=2 sts=2
 * */
var app = {
  socket:  null,
  mediaTrack: null,
  counter: 0,
  bufferSize: 4096,
  main: function() {
    // this.socket = new WebSocket("ws://10.78.98.103:9000");
    this.socket = new WebSocket("ws://localhost:9000");
    this.socket.addEventListener("open", this.onSocketOpen.bind(this));
    this.socket.addEventListener("message", this.onSocketMessage.bind(this));
  },
  onSocketOpen: function(event) {
    this.initRecorder();
    console.log("onSocketOpen", event);
  },
  onSocketMessage: function(event) {
    console.log("Message", event.data);
    document.getElementById("transcript").innerHTML += "<p>" + event.data + "</p>"
  },
  shimAudioContext: function() {
    try {
      // Shims
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      navigator.getUserMedia = navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia;
    } catch (e) {
      alert("Your browser is not supported");
      return false;
    }

    if(!navigator.getUserMedia || !window.AudioContext) {
      alert("Your browser is not supported");
      return false;
    }
    return true;
  },
  initRecorder: function() {
    // shim audio context
    if (!this.shimAudioContext()) {
      return;
    }

    return navigator.mediaDevices.getUserMedia({"audio": true, "video": false}).then((stream) => {
      var context = new window.AudioContext();

      // send metadata on audio stream to backend
      this.socket.send(JSON.stringify({
        rate: context.sampleRate,
        language: "en-US",
        format: "LINEAR16"
      }));

      // Caputure mic audio data into a stream
      var audioInput = context.createMediaStreamSource(stream);

      // only record mono audio w/a buffer of 2048 bits per function call
      var recorder = context.createScriptProcessor(this.bufferSize, 1, 1);

      // specify the processing function
      recorder.onaudioprocess = this.audioProcess.bind(this);

      // connect stream to our recorder
      audioInput.connect(recorder);

      // connect recorder to previous destination
      recorder.connect(context.destination);

      // store media track
      this.mediaTrack = stream.getTracks()[0];
    });
  },
  float32To16BitPCM: function(float32Arr) {
    var pcm16bit = new Int16Array(float32Arr.length);
    for(var i = 0; i < float32Arr.length; ++i) {

      // force number in [-1,1]
      var s = Math.max(-1, Math.min(1, float32Arr[i]));

      /**
       * convert 32 bit float to 16 bit int pcm audio
       * 0x8000 = minimum int16 value, 0x7fff = maximum int16 value
       */
      pcm16bit[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16bit;
  },
  audioProcess: function(event) {
    // only 1 channel as specified above.....
    //

      var float32Audio = event.inputBuffer.getChannelData(0) || new Flaot32Array(this.bufferSize);
      var pcm16Audio = this.float32To16BitPCM(float32Audio);

      /*
      console.log(float32Audio);
      console.log(float32Audio.buffer);
      console.log(pcm16Audio);
      console.log(pcm16Audio.buffer);
      */

      this.socket.send(pcm16Audio.buffer);

  }
};
console.log("Getting started");
app.main();

