// 端末の向き（真北基準のヘディング）を取得する。
// Android Chrome は deviceorientationabsolute、iOS Safari は
// DeviceOrientationEvent.requestPermission() + webkitCompassHeading が必要。
// どちらも取れない端末では null を返し、UI 側で「北を上」表示にフォールバックする。

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }
  return 0;
}

function headingFromEvent(event) {
  // iOS Safari は真北基準の値を直接くれる。
  if (typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
    return event.webkitCompassHeading;
  }
  // alpha は反時計回りなので反転し、画面の回転ぶんを足し戻す。
  if (event.absolute === true && typeof event.alpha === 'number') {
    return (360 - event.alpha + screenAngle()) % 360;
  }
  return null;
}

export function createCompass(onHeading) {
  let eventName = null;
  let handler = null;

  const listen = (name) => {
    eventName = name;
    handler = (event) => {
      const heading = headingFromEvent(event);
      if (heading !== null) onHeading(heading);
    };
    window.addEventListener(name, handler);
  };

  return {
    /** 呼び出しはユーザー操作（クリック等）の中から行うこと。iOS の許可要求がブロックされるため。 */
    async start() {
      const DOE = window.DeviceOrientationEvent;
      if (!DOE) return false;

      if (typeof DOE.requestPermission === 'function') {
        try {
          const state = await DOE.requestPermission();
          if (state !== 'granted') return false;
        } catch {
          return false;
        }
        listen('deviceorientation');
        return true;
      }

      if ('ondeviceorientationabsolute' in window) {
        listen('deviceorientationabsolute');
      } else {
        listen('deviceorientation');
      }
      return true;
    },

    stop() {
      if (eventName && handler) window.removeEventListener(eventName, handler);
      eventName = null;
      handler = null;
    },
  };
}
