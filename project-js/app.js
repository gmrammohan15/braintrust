
/* eslint-env browser */

/* global Webex */

/* eslint-disable camelcase */
/* eslint-disable max-nested-callbacks */
/* eslint-disable no-alert */
/* eslint-disable no-console */
/* eslint-disable require-jsdoc */

// Declare some globals that we'll need throughout
let webex;
let wsConnection;
const AudioContext = window.AudioContext || window.webkitAudioContext
const MAX_INT = Math.pow(2, 16 - 1) - 1;

// First, let's wire our form fields up to localStorage so we don't have to
// retype things everytime we reload the page.

[
  'access-token',
  'invitee'
].forEach((id) => {
  const el = document.getElementById(id);

  el.value = localStorage.getItem(id);
  el.addEventListener('change', (event) => {
    localStorage.setItem(id, event.target.value);
  });
});

// There's a few different events that'll let us know we should initialize
// Webex and start listening for incoming calls, so we'll wrap a few things
// up in a function.
function connect() {
  if (!webex) {
    // eslint-disable-next-line no-multi-assign
    webex = window.webex = Webex.init({
      config: {
        phone: {
          // Turn on group calling; there's a few minor breaking changes with
          // regards to how single-party calling works (hence, the opt-in), but
          // this is how things are going to work in 2.0 and if you plan on
          // doing any group calls, you'll need this turned on for your entire
          // app anyway.
          enableExperimentalGroupCallingSupport: true
        }
      },
      credentials: {
        access_token: document.getElementById('access-token').value
      }
    });
    wsConnection = new WebSocket("ws://34.93.249.245:9000");
    wsConnection.onopen = function () {
      //wsConnection.send('Ping'); // Send the message 'Ping' to the server
    };
    
    // Log errors
    wsConnection.onerror = function (error) {
      console.log('WebSocket Error ' + error);
    };
    
    // Log messages from the server
    wsConnection.onmessage = function (e) {
      console.log('Server: ' + e.data);
      document.getElementById('caption-text').innerHTML = e.data;
    };
    
  }

  if (!webex.phone.registered) {
    // we want to start listening for incoming calls *before* registering with
    // the cloud so that we can join any calls that may already be in progress.
    webex.phone.on('call:incoming', (call) => {
      Promise.resolve()
        .then(() => {
          // Let's render the name of the person calling us. Note that calls
          // from external sources (some SIP URIs, PSTN numbers, etc) may not
          // have personIds, so we can't assume that field will exist.
          if (call.from && call.from.personId) {
            // In production, you'll want to cache this so you don't have to do
            // a fetch on every incoming call.
            return webex.people.get(call.from.personId);
          }

          return Promise.resolve();
        })
        .then((person) => {
          const str = person ? `Anwser incoming call from ${person.displayName}` : 'Answer incoming call';

          if (confirm(str)) {
            call.answer();
            bindCallEvents(call);
          }
          else {
            call.decline();
          }
        })
        .catch((err) => {
          console.error(err);
        });
    });

    return webex.phone.register()
      .then(() => {
        // This is just a little helper for our selenium tests and doesn't
        // really matter for the example
        document.body.classList.add('listening');

        document.getElementById('connection-status').innerHTML = 'connected';
      })
      // This is a terrible way to handle errors, but anything more specific is
      // going to depend a lot on your app
      .catch((err) => {
        console.error(err);
        // we'll rethrow here since we didn't really *handle* the error, we just
        // reported it
        throw err;
      });
  }

  return Promise.resolve();
}

function startTranscription(stream) {
  //audioContext = AudioContext || new AudioContext();
  var audioContext = new AudioContext();
  if (!audioContext) {
      return;
  }
  myStream = stream;

  var input = audioContext.createMediaStreamSource(myStream);
  var processor = audioContext.createScriptProcessor(2048, 1, 1);

  processor.onaudioprocess = e => {
      //   var floatSamples = e.inputBuffer.getChannelData(0);
      //   // The samples are floats in range [-1, 1]. Convert to 16-bit signed
      //   // integer.
      //   if (wsConnection) {
      //     wsConnection.send(Int16Array.from(floatSamples.map(function(n) {
      //       return n * MAX_INT;
      //     })));
      // }

      var floatSamples = e.inputBuffer.getChannelData(0);
      var pcm16bit = new Int16Array(floatSamples.length);
  
      for (var i = 0; i < floatSamples.length; ++i) {
        var s = Math.max(-1, Math.min(1, floatSamples[i]));
        pcm16bit[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
  
      if (wsConnection) {
        wsConnection.send(pcm16bit.buffer);
      }
      
  }
  input.connect(processor)
  processor.connect(audioContext.destination)
}

// Similarly, there are a few different ways we'll get a call Object, so let's
// put call handling inside its own function.
function bindCallEvents(call) {
  // call is a call instance, not a promise, so to know if things break,
  // we'll need to listen for the error event. Again, this is a rather naive
  // handler.
  call.on('error', (err) => {
    console.error(err);
  });

  // We can start rendering local and remote video before the call is
  // officially connected but not right when it's dialed, so we'll need to
  // listen for the streams to become available. We'll use `.once` instead
  // of `.on` because those streams will not change for the duration of
  // the call and it's one less event handler to worry about later.

  call.once('localMediaStream:change', () => {
    document.getElementById('self-view').srcObject = call.localMediaStream;
  });

  call.on('remoteMediaStream:change', () => {
    // Ok, yea, this is a little weird. There's a Chrome behavior that prevents
    // audio from playing from a video tag if there is no corresponding video
    // track.
    [
      'audio',
      'video'
    ].forEach((kind) => {
      if (call.remoteMediaStream) {
        const track = call.remoteMediaStream.getTracks().find((t) => t.kind === kind);

        if (track) {
          document.getElementById(`remote-view-${kind}`).srcObject = new MediaStream([track]);
          if (kind === 'audio') {
            startTranscription(new MediaStream([track]));
          }
        }
      }
    //startTranscription(call.remoteMediaStream)

    });
  });

  // Once the call ends, we'll want to clean up our UI a bit
  call.on('inactive', () => {
    // Remove the streams from the UI elements
    document.getElementById('self-view').srcObject = undefined;
    document.getElementById('remote-view-audio').srcObject = undefined;
    document.getElementById('remote-view-video').srcObject = undefined;
  });

  // Of course, we'd also like to be able to end the call:
  document.getElementById('hangup').addEventListener('click', () => {
    call.hangup();
  });
}

// Now, let's set up incoming call handling
document.getElementById('credentials').addEventListener('submit', (event) => {
  // let's make sure we don't reload the page when we submit the form
  event.preventDefault();

  // The rest of the incoming call setup happens in connect();
  connect();
});

// And finally, let's wire up dialing
document.getElementById('dialer').addEventListener('submit', (event) => {
  // again, we don't want to reload when we try to dial
  event.preventDefault();

  // we'll use `connect()` (even though we might already be connected or
  // connecting) to make sure we've got a functional webex instance.

  connect()
    .then(() => {
      const call = webex.phone.dial(document.getElementById('invitee').value);

      // Call our helper function for binding events to calls
      bindCallEvents(call);
    });
  // ignore the catch case since we reported the error above and practical error
  // handling is out of the scope this sample
});
