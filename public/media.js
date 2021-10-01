const { desktopCapturer } = require('electron')

var button = document.getElementById('button');

button.addEventListener('click', function(e) {
  //e.preventDefault();
  getCapture();
});

function getCapture() {
  desktopCapturer.getSources({ types: ['screen'] }) // 'window' 追加でウィンドウ選べる
  .then(async sources => {
    for (const source of sources) {
      if (source.name === sources[0]) { // TODO: いったんデスクトップ固定
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
              }
            }
          });
          handleStream(stream);
        } catch (e) {
          handleError(e);
        }
        return;
      }
    }
  })
  .catch(e => handleError(e));
}

function handleStream (stream) {
  const video = document.querySelector('video')
  video.srcObject = stream
  video.onloadedmetadata = (e) => video.play()
}

function handleError (e) {
  console.log(e);
  capture_error.innerText = e;
}
