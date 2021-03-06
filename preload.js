const localVideo = document.getElementById('local_video');
let localStream = null;
let clientId = null;
let device = null;
let producerTransport = null;
let videoProducer = null;
let audioProducer = null;
let consumerTransport = null;
let videoConsumer = null;
let audioConsumer = null;

// ---- TODO ----
//  DONE - (check can consumer for subcribe) --> subscribe before publish
//  - audio track
//  - multiple rooms


// =========== socket.io ========== 
let socket = null;

// return Promise
function connectSocket() {
  if (socket) {
    socket.close();
    socket = null;
    clientId = null;
  }

  return new Promise((resolve, reject) => {
    socket = io.connect('/');

    socket.on('connect', function (evt) {
      console.log('socket.io connected()');
    });
    socket.on('error', function (err) {
      console.error('socket.io ERROR:', err);
      reject(err);
    });
    socket.on('disconnect', function (evt) {
      console.log('socket.io disconnect:', evt);
    });
    socket.on('message', function (message) {
      console.log('socket.io message:', message);
      if (message.type === 'welcome') {
        if (socket.id !== message.id) {
          console.warn('WARN: something wrong with clientID', socket.io, message.id);
        }

        clientId = message.id;
        console.log('connected to server. clientId=' + clientId);
        resolve();
      }
      else {
        console.error('UNKNOWN message from server:', message);
      }
    });
    socket.on('newProducer', async function (message) {
      console.log('socket.io newProducer:', message);
      if (consumerTransport) {
        // start consume
        if (message.kind === 'video') {
          videoConsumer = await consumeAndResume(consumerTransport, message.kind);
        }
        else if (message.kind === 'audio') {
          audioConsumer = await consumeAndResume(consumerTransport, message.kind);
        }
      }
    });
  });
}

function disconnectSocket() {
  if (socket) {
    socket.close();
    socket = null;
    clientId = null;
    console.log('socket.io closed..');
  }
}

function isSocketConnected() {
  if (socket) {
    return true;
  }
  else {
    return false;
  }
}

function sendRequest(type, data) {
  return new Promise((resolve, reject) => {
    socket.emit(type, data, (err, response) => {
      if (!err) {
        // Success response, so pass the mediasoup response to the local Room.
        resolve(response);
      } else {
        reject(err);
      }
    });
  });
}

// =========== media handling ========== 
function stopLocalStream(stream) {
  let tracks = stream.getTracks();
  if (!tracks) {
    console.warn('NO tracks');
    return;
  }

  tracks.forEach(track => track.stop());
}

// return Promise
function playVideo(element, stream) {
  if (element.srcObject) {
    console.warn('element ALREADY playing, so ignore');
    return;
  }
  element.srcObject = stream;
  element.volume = 0;
  return element.play();
}

function pauseVideo(element) {
  element.pause();
  element.srcObject = null;
}

function addRemoteTrack(id, track) {
  let video = findRemoteVideo(id);
  if (!video) {
    video = addRemoteVideo(id);
  }

  if (video.srcObject) {
    video.srcObject.addTrack(track);
    return;
  }

  const newStream = new MediaStream();
  newStream.addTrack(track);
  playVideo(video, newStream)
    .then(() => { video.volume = 1.0 })
    .catch(err => { console.error('media ERROR:', err) });
}

function addRemoteVideo(id) {
  let existElement = findRemoteVideo(id);
  if (existElement) {
    console.warn('remoteVideo element ALREADY exist for id=' + id);
    return existElement;
  }

  let element = document.createElement('video');
  remoteContainer.appendChild(element);
  element.id = 'remote_' + id;
  element.width = 240;
  element.height = 180;
  element.volume = 0;
  //element.controls = true;
  element.style = 'border: solid black 1px;';
  return element;
}

function findRemoteVideo(id) {
  let element = document.getElementById('remote_' + id);
  return element;
}

function removeRemoteVideo(id) {
  console.log(' ---- removeRemoteVideo() id=' + id);
  let element = document.getElementById('remote_' + id);
  if (element) {
    element.pause();
    element.srcObject = null;
    remoteContainer.removeChild(element);
  }
  else {
    console.log('child element NOT FOUND');
  }
}

function removeAllRemoteVideo() {
  while (remoteContainer.firstChild) {
    remoteContainer.firstChild.pause();
    remoteContainer.firstChild.srcObject = null;
    remoteContainer.removeChild(remoteContainer.firstChild);
  }
}

// ============ UI button ==========
function checkUseVideo() {
  const useVideo = document.getElementById('use_video').checked;
  return useVideo;
}

function checkUseAudio() {
  const useAudio = document.getElementById('use_audio').checked;
  return useAudio;
}

function startMedia() {
  if (localStream) {
    console.warn('WARN: local media ALREADY started');
    return;
  }

  const useVideo = checkUseVideo();
  const useAudio = checkUseAudio();

  navigator.mediaDevices.getUserMedia({ audio: useAudio, video: useVideo })
    .then((stream) => {
      localStream = stream;
      playVideo(localVideo, localStream);
      updateButtons();
    })
    .catch(err => {
      console.error('media ERROR:', err);
    });
}

function stopMedia() {
  if (localStream) {
    pauseVideo(localVideo);
    stopLocalStream(localStream);
    localStream = null;
  }
  updateButtons();
}

async function publish() {
  if (!localStream) {
    console.warn('WARN: local media NOT READY');
    return;
  }

  // --- connect socket.io ---
  if (!isSocketConnected()) {
    await connectSocket().catch(err => {
      console.error(err);
      return;
    });

    // --- get capabilities --
    const data = await sendRequest('getRouterRtpCapabilities', {});
    console.log('getRouterRtpCapabilities:', data);
    await loadDevice(data);
  }

  updateButtons();

  // --- get transport info ---
  console.log('--- createProducerTransport --');
  const params = await sendRequest('createProducerTransport', {});
  console.log('transport params:', params);
  producerTransport = device.createSendTransport(params);
  console.log('createSendTransport:', producerTransport);

  // --- join & start publish --
  producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    console.log('--trasnport connect');
    sendRequest('connectProducerTransport', { dtlsParameters: dtlsParameters })
      .then(callback)
      .catch(errback);
  });

  producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
    console.log('--trasnport produce');
    try {
      const { id } = await sendRequest('produce', {
        transportId: producerTransport.id,
        kind,
        rtpParameters,
      });
      callback({ id });
    } catch (err) {
      errback(err);
    }
  });

  producerTransport.on('connectionstatechange', (state) => {
    switch (state) {
      case 'connecting':
        console.log('publishing...');
        break;

      case 'connected':
        console.log('published');
        break;

      case 'failed':
        console.log('failed');
        producerTransport.close();
        break;

      default:
        break;
    }
  });

  const useVideo = checkUseVideo();
  const useAudio = checkUseAudio();
  if (useVideo) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const trackParams = { track: videoTrack };
      videoProducer = await producerTransport.produce(trackParams);
    }
  }
  if (useAudio) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const trackParams = { track: audioTrack };
      audioProdcuer = await producerTransport.produce(trackParams);
    }
  }

  updateButtons();
}

async function subscribe() {
  if (!isSocketConnected()) {
    await connectSocket().catch(err => {
      console.error(err);
      return;
    });

    // --- get capabilities --
    const data = await sendRequest('getRouterRtpCapabilities', {});
    console.log('getRouterRtpCapabilities:', data);
    await loadDevice(data);
  }

  updateButtons();

  // --- prepare transport ---
  console.log('--- createConsumerTransport --');
  const params = await sendRequest('createConsumerTransport', {});
  console.log('transport params:', params);
  consumerTransport = device.createRecvTransport(params);
  console.log('createConsumerTransport:', consumerTransport);

  // --- NG ---
  //sendRequest('connectConsumerTransport', { dtlsParameters: dtlsParameters })
  //  .then(callback)
  //  .catch(errback);

  // --- try --- not well
  //sendRequest('connectConsumerTransport', { dtlsParameters: params.dtlsParameters })
  //  .then(() => console.log('connectConsumerTransport OK'))
  //  .catch(err => console.error('connectConsumerTransport ERROR:', err));

  // --- join & start publish --
  consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    console.log('--consumer trasnport connect');
    sendRequest('connectConsumerTransport', { dtlsParameters: dtlsParameters })
      .then(callback)
      .catch(errback);

    //consumer = await consumeAndResume(consumerTransport);
  });

  consumerTransport.on('connectionstatechange', (state) => {
    switch (state) {
      case 'connecting':
        console.log('subscribing...');
        break;

      case 'connected':
        console.log('subscribed');
        break;

      case 'failed':
        console.log('failed');
        producerTransport.close();
        break;

      default:
        break;
    }
  });

  videoConsumer = await consumeAndResume(consumerTransport, 'video');
  audioConsumer = await consumeAndResume(consumerTransport, 'audio');

  updateButtons();
}

async function consumeAndResume(transport, kind) {
  const consumer = await consume(consumerTransport, kind);
  if (consumer) {
    console.log('-- track exist, consumer ready. kind=' + kind);
    updateButtons();
    if (kind === 'video') {
      console.log('-- resume kind=' + kind);
      sendRequest('resume', { kind: kind })
        .then(() => {
          console.log('resume OK');
          return consumer;
        })
        .catch(err => {
          console.error('resume ERROR:', err);
          return consumer;
        });
    }
    else {
      console.log('-- do not resume kind=' + kind);
    }
  }
  else {
    console.log('-- no consumer yet. kind=' + kind);
    return null;
  }
}

function disconnect() {
  if (localStream) {
    pauseVideo(localVideo);
    stopLocalStream(localStream);
    localStream = null;
  }
  if (videoProducer) {
    videoProducer.close(); // localStream will stop
    videoProducer = null;
  }
  if (audioProducer) {
    audioProducer.close(); // localStream will stop
    audioProducer = null;
  }
  if (producerTransport) {
    producerTransport.close(); // localStream will stop
    producerTransport = null;
  }

  if (videoConsumer) {
    videoConsumer.close();
    videoConsumer = null;
  }
  if (audioConsumer) {
    audioConsumer.close();
    audioConsumer = null;
  }
  if (consumerTransport) {
    consumerTransport.close();
    consumerTransport = null;
  }

  removeAllRemoteVideo();

  disconnectSocket();
  updateButtons();
}

async function loadDevice(routerRtpCapabilities) {
  try {
    device = new MediasoupClient.Device();
  } catch (error) {
    if (error.name === 'UnsupportedError') {
      console.error('browser not supported');
    }
  }
  await device.load({ routerRtpCapabilities });
}

async function consume(transport, trackKind) {
  console.log('--start of consume --kind=' + trackKind);
  const { rtpCapabilities } = device;
  //const data = await socket.request('consume', { rtpCapabilities });
  const data = await sendRequest('consume', { rtpCapabilities: rtpCapabilities, kind: trackKind })
    .catch(err => {
      console.error('consume ERROR:', err);
    });
  const {
    producerId,
    id,
    kind,
    rtpParameters,
  } = data;

  if (producerId) {
    let codecOptions = {};
    const consumer = await transport.consume({
      id,
      producerId,
      kind,
      rtpParameters,
      codecOptions,
    });
    //const stream = new MediaStream();
    //stream.addTrack(consumer.track);

    addRemoteTrack(clientId, consumer.track);

    console.log('--end of consume');
    //return stream;

    return consumer;
  }
  else {
    console.warn('--- remote producer NOT READY');

    return null;
  }
}


// ---- UI control ----
function updateButtons() {
  if (localStream) {
    disableElement('start_video_button');
    disableElement('use_video');
    disableElement('use_audio');
    if (isSocketConnected()) {
      disableElement('stop_video_button');
    }
    else {
      enabelElement('stop_video_button');
    }

    if (videoProducer || audioProducer) {
      disableElement('publish_button');
    }
    else {
      enabelElement('publish_button');
    }
  }
  else {
    enabelElement('start_video_button');
    enabelElement('use_video');
    enabelElement('use_audio');
    disableElement('stop_video_button');
    disableElement('publish_button');
  }

  if (isSocketConnected()) {
    enabelElement('disconnect_button');
  }
  else {
    disableElement('disconnect_button');
  }

  if (consumerTransport) {
    disableElement('subscribe_button');
  }
  else {
    enabelElement('subscribe_button');
  }
}


function enabelElement(id) {
  let element = document.getElementById(id);
  if (element) {
    element.removeAttribute('disabled');
  }
}

function disableElement(id) {
  let element = document.getElementById(id);
  if (element) {
    element.setAttribute('disabled', '1');
  }
}

updateButtons();
console.log('=== ready ===');