const photo = document.querySelector('#photo');
const empty = document.querySelector('#empty');
const viewer = document.querySelector('#viewer');

let photos = [];
let index = 0;
let scale = 1;
let panX = 0;
let panY = 0;
let primaryStart = null;
let gestureStart = null;
let usedMultiTouch = false;
const pointers = new Map();

init();

async function init() {
  const requestedPhoto = new URLSearchParams(window.location.search).get('photo');
  const response = await fetch('/api/photos');
  const data = await response.json();
  photos = shuffle(data.photos ?? []);

  if (requestedPhoto) {
    const requestedIndex = photos.findIndex((item) => item.id === requestedPhoto);
    if (requestedIndex >= 0) {
      const [requested] = photos.splice(requestedIndex, 1);
      photos.unshift(requested);
    }
    window.history.replaceState(null, '', '/');
  }

  showPhoto(0);
}

function shuffle(items) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function showPhoto(nextIndex) {
  resetZoom();

  if (photos.length === 0) {
    photo.hidden = true;
    empty.hidden = false;
    return;
  }

  index = wrapIndex(nextIndex);
  photo.hidden = false;
  empty.hidden = true;
  photo.src = photos[index].url;
}

function wrapIndex(value) {
  return (value + photos.length) % photos.length;
}

function nextPhoto() {
  if (photos.length > 0) {
    showPhoto(index + 1);
  }
}

function previousPhoto() {
  if (photos.length > 0) {
    showPhoto(index - 1);
  }
}

function resetZoom() {
  scale = 1;
  panX = 0;
  panY = 0;
  applyTransform();
}

function applyTransform() {
  photo.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointCenter(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

viewer.addEventListener('pointerdown', (event) => {
  viewer.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pointers.size === 1) {
    usedMultiTouch = false;
    primaryStart = {
      x: event.clientX,
      y: event.clientY,
      panX,
      panY,
    };
  }

  if (pointers.size === 2) {
    usedMultiTouch = true;
    const [first, second] = [...pointers.values()];
    gestureStart = {
      center: pointCenter(first, second),
      distance: pointDistance(first, second),
      panX,
      panY,
      scale,
    };
  }
});

viewer.addEventListener('pointermove', (event) => {
  if (!pointers.has(event.pointerId)) {
    return;
  }

  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pointers.size >= 2 && gestureStart) {
    event.preventDefault();
    const [first, second] = [...pointers.values()];
    const center = pointCenter(first, second);
    const distance = pointDistance(first, second);
    scale = clamp(gestureStart.scale * (distance / gestureStart.distance), 1, 5);
    panX = gestureStart.panX + center.x - gestureStart.center.x;
    panY = gestureStart.panY + center.y - gestureStart.center.y;

    if (scale === 1) {
      panX = 0;
      panY = 0;
    }

    applyTransform();
    return;
  }

  if (pointers.size === 1 && primaryStart && scale > 1) {
    event.preventDefault();
    panX = primaryStart.panX + event.clientX - primaryStart.x;
    panY = primaryStart.panY + event.clientY - primaryStart.y;
    applyTransform();
  }
});

viewer.addEventListener('pointerup', endPointer);
viewer.addEventListener('pointercancel', endPointer);

function endPointer(event) {
  const start = primaryStart;
  pointers.delete(event.pointerId);

  if (pointers.size === 1) {
    const [remaining] = pointers.values();
    primaryStart = {
      x: remaining.x,
      y: remaining.y,
      panX,
      panY,
    };
    gestureStart = null;
    return;
  }

  if (pointers.size === 0) {
    gestureStart = null;

    if (!usedMultiTouch && start && scale === 1) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) {
          nextPhoto();
        } else {
          previousPhoto();
        }
      }
    }

    primaryStart = null;
    usedMultiTouch = false;
  }
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') {
    nextPhoto();
  } else if (event.key === 'ArrowLeft') {
    previousPhoto();
  } else if (event.key === 'Escape') {
    resetZoom();
  }
});
